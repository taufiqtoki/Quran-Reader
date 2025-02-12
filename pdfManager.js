import { auth, syncBookmarks } from './auth.js';
import { showToast } from './utils.js';
import { addBookmark, updateLastRead, deleteBookmark as deleteFirestoreBookmark } from './firestoreManager.js';

// Variable declarations
const dbName = 'pdfCacheDB', storeName = 'pages';
let db, pdfDoc = null, pageIsRendering = false, pageNumPending = null, scale = window.devicePixelRatio || 1;
const canvas = document.getElementById('pdf-render'), ctx = canvas.getContext('2d');
let renderTask = null, bookmarks = JSON.parse(localStorage.getItem('bookmarks')) || {}, pageNum = localStorage.getItem('lastPage') ? parseInt(localStorage.getItem('lastPage'), 10) : 1;
let autoSaveTimer;

// Constants
const MAX_CACHED_PAGES = 50;
// const PAGE_CHANGE_DEBOUNCE = 300; // Duplicate declaration removed
const PAGE_BUFFER_SIZE = 2; // Number of pages to buffer in each direction

// Add PageState enum before it's used
const PageState = {
    UNLOADED: 0,
    LOADING: 1,
    LOADED: 2,
    RENDERED: 3,
    ERROR: 4
};

// Add these near the top with other state variables
let totalCachedPages = 0;
let totalPrefetchedPages = 0;
let totalRenderedPages = 0;

// Add this near the top with other state variables
const loadQueue = {
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low',
    queues: {
        high: new Set(),
        medium: new Set(),
        low: new Set()
    },
    
    add(page, priority = 'medium') {
        this.queues[priority].add(page);
        if (priority === this.HIGH) {
            this.process();
        }
    },
    
    clear(priority = 'medium') {
        this.queues[priority].clear();
    },
    
    async process() {
        // Process high priority first
        for (const page of this.queues.high) {
            await loadPageWithPriority(page, this.HIGH);
            this.queues.high.delete(page);
        }
        
        // Process medium priority in background
        for (const page of this.queues.medium) {
            loadPageWithPriority(page, this.MEDIUM);
            this.queues.medium.delete(page);
        }
    }
};

// State management
let isPdfReady = false;
let isPageChanging = false;
let pageChangeQueue = [];
const PAGE_CHANGE_DEBOUNCE = 300;

const pageLoadStates = {
    promises: new Map(),  // Track loading promises
    cache: new Map(),     // Cache loaded pages
    states: new Map()     // Track page states
};

let currentLoadingPromises = new Map(); // Initialize the map
let pageCache = new Map();   // Initialize page cache
let pageStates = new Map();  // Initialize page states

// Navigation manager
const pageNavigationManager = {
    async changePage(newPage, options = {}) {
        if (isPageChanging) {
            if (options.force) {
                pageChangeQueue = [];
            } else {
                pageChangeQueue.push(() => this.changePage(newPage, options));
                return;
            }
        }

        isPageChanging = true;
        canvas.style.opacity = '0.3';
        canvas.style.transition = 'opacity 0.2s ease';

        try {
            if (newPage < 1 || newPage > pdfDoc.numPages) return;
            
            pageNum = newPage;
            await queueRenderPage(pageNum, true);
            updateBookmarkList();
            localStorage.setItem('lastPage', pageNum);
            
            document.getElementById('page-info').textContent = `Page ${pageNum} of ${pdfDoc.numPages}`;
            document.getElementById('page-info-controls').textContent = `Page ${pageNum} of ${pdfDoc.numPages}`;
            updatePageProgress(pageNum);
            updateStarColor();

            if (auth.currentUser) {
                await updateLastRead(auth.currentUser.uid, pageNum);
            }

            canvas.style.opacity = '1';
        } catch (error) {
            console.error('Page change error:', error);
            canvas.style.opacity = '1';
        } finally {
            isPageChanging = false;
            if (pageChangeQueue.length > 0) {
                const nextChange = pageChangeQueue.pop();
                pageChangeQueue = [];
                nextChange();
            }
        }
    }
};

// Core navigation functions
const goToNextPage = async () => {
    if (!pdfDoc || !isPdfReady) return;
    await pageNavigationManager.changePage(pageNum + 1);
};

const goToPreviousPage = async () => {
    if (!pdfDoc || !isPdfReady) return;
    await pageNavigationManager.changePage(pageNum - 1);
};

// Event handlers
const handleWheel = (event) => {
    if (!pdfDoc || isPageChanging) return;
    if (!event.deltaY) return;
    
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
        if (event.deltaY > 0) {
            goToNextPage();
        } else {
            goToPreviousPage();
        }
    }, PAGE_CHANGE_DEBOUNCE);
};

const handleMouseUpDown = (event) => {
    if (event.button === 4) {
        goToPreviousPage();
    } else if (event.button === 5) {
        goToNextPage();
    }
};

const openDB = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = (event) => {
        db = event.target.result;
        db.createObjectStore(storeName, { keyPath: 'page' });
    };
    request.onsuccess = (event) => {
        db = event.target.result;
        resolve();
    };
    request.onerror = (event) => reject(event.target.error);
});

const getCachedPage = (page) => new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(page);
    request.onsuccess = (event) => resolve(event.target.result ? event.target.result.dataUrl : null);
    request.onerror = (event) => reject(event.target.error);
});

const cachePage = (page, dataUrl) => {
    if (!db) return; // Guard against db not being initialized
    
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    store.put({ page, dataUrl });
    totalCachedPages++;

    // Check if the number of cached pages exceeds the limit
    if (totalCachedPages > MAX_CACHED_PAGES) {
        // Delete the oldest cached page
        store.openCursor().onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                store.delete(cursor.key);
                totalCachedPages--;
            }
        };
    }
};

const deleteCachedPage = (page) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    store.delete(page);
};

const updateBookmarkList = () => {
    const bookmarkList = document.getElementById('bookmark-list');
    if (!bookmarkList) return;

    bookmarkList.innerHTML = '';
    Object.entries(window.bookmarks || {}).sort(([a], [b]) => parseInt(a) - parseInt(b)).forEach(([page, bookmark]) => {
        if (bookmark) {
            const li = document.createElement('li');
            li.className = 'flex justify-between items-center bg-gray-200 px-4 py-2 rounded';
            li.innerHTML = `
                <span class="cursor-pointer" onclick="jumpToBookmark(${page})">
                    ${bookmark.name} (Page ${page})
                </span>
                <div class="flex space-x-2">
                    <button class="text-blue-500" onclick="editBookmark(${page})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="text-red-500" onclick="confirmDeleteBookmark(${page})">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            `;
            bookmarkList.appendChild(li);
        }
    });
    
    updateStarColor();
};

// Update the jumpToBookmark function
const jumpToBookmark = async (page) => {
    if (!pdfDoc || !isPdfReady) return;
    await pageNavigationManager.changePage(parseInt(page, 10), { force: true });
};

const startAutoSaveTimer = () => {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
        saveBookmark();
    }, 10000); // 10 seconds
};

const addBookmarkModal = () => {
    document.getElementById('modal-page-number').value = pageNum;
    document.getElementById('modal-bookmark-name').value = bookmarks[pageNum] ? bookmarks[pageNum].name : 'Continue';
    const modal = document.getElementById('bookmark-modal');
    modal.classList.remove('hidden');
    modal.removeAttribute('inert');
    document.addEventListener('keydown', handleModalKeyDown);
    document.addEventListener('click', handleModalClick, true);
    
    // Don't start auto-save timer if save button exists
    const saveButton = document.getElementById('save-bookmark');
    if (!saveButton) {
        startAutoSaveTimer();
    }

    // Cancel auto-save on input
    const nameInput = document.getElementById('modal-bookmark-name');
    nameInput.addEventListener('input', () => {
        clearTimeout(autoSaveTimer);
    });
};

const saveBookmark = async () => {
    clearTimeout(autoSaveTimer);
    
    const page = parseInt(document.getElementById('modal-page-number').value, 10);
    const name = document.getElementById('modal-bookmark-name').value.trim();
    if (!page || !name) return;

    // Check for existing bookmark with same name or page locally
    const existingBookmark = Object.entries(window.bookmarks || {}).find(([p, b]) => 
        b.name === name || parseInt(p) === page
    );

    if (existingBookmark) {
        showToast('Bookmark already exists');
        closeModal();
        return;
    }

    try {
        // Save to Firestore first if user is logged in
        let bookmarkId;
        if (auth.currentUser) {
            bookmarkId = await addBookmark(auth.currentUser.uid, name, page);
        }

        // Only save locally if Firestore operation succeeded or user is not logged in
        window.bookmarks[page] = { name, id: bookmarkId };
        localStorage.setItem('bookmarks', JSON.stringify(window.bookmarks));
        updateBookmarkList();
        closeModal();
        showToast('Bookmark saved');
    } catch (error) {
        console.error('Error saving bookmark:', error);
        showToast('Error saving bookmark');
    }
};

const editBookmark = (page) => {
    const bookmark = bookmarks[page];
    document.getElementById('modal-page-number').value = page;
    document.getElementById('modal-bookmark-name').value = bookmark.name;
    const modal = document.getElementById('bookmark-modal');
    modal.classList.remove('hidden');
    modal.removeAttribute('inert');
    const saveButton = document.getElementById('save-bookmark');
    saveButton.onclick = () => {
        bookmarks[page] = {
            name: document.getElementById('modal-bookmark-name').value.trim()
        };
        updateBookmarkList();
        closeModal();
        showToast('Bookmark edited');
        clearTimeout(autoSaveTimer); // Clear the auto-save timer
    };
    document.getElementById('bookmark-modal').onkeydown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            saveButton.click();
        }
    };
    startAutoSaveTimer(); // Start the auto-save timer
};

const confirmDeleteBookmark = (page) => {
    const modal = document.getElementById('confirm-delete-modal');
    modal.classList.remove('hidden');
    modal.removeAttribute('inert');
    modal.focus();
    document.addEventListener('keydown', handleConfirmDeleteKeyDown, true);
    document.getElementById('confirm-delete').onclick = () => {
        deleteBookmark(page);
        closeConfirmDeleteModal();
    };
};

const deleteBookmark = async (page) => {
    console.log('Deleting bookmark:', { page, bookmark: window.bookmarks[page] });
    const bookmark = window.bookmarks[page];
    if (!bookmark) {
        console.log('No bookmark found for page:', page);
        return;
    }

    // Delete locally first
    delete window.bookmarks[page];
    localStorage.setItem('bookmarks', JSON.stringify(window.bookmarks));
    updateBookmarkList(); // Update UI immediately
    
    console.log('Bookmark deleted locally');
    
    // Then sync with server if user is signed in
    if (auth.currentUser && bookmark.id) {
        try {
            console.log('Attempting server deletion:', bookmark.id);
            await deleteFirestoreBookmark(auth.currentUser.uid, bookmark.id);
            console.log('Server deletion successful');
            showToast('Bookmark deleted');
        } catch (error) {
            console.error('Server deletion failed:', error);
            // Restore bookmark on server error
            window.bookmarks[page] = bookmark;
            localStorage.setItem('bookmarks', JSON.stringify(window.bookmarks));
            updateBookmarkList();
            showToast('Error deleting bookmark from server');
        }
    } else {
        showToast('Bookmark deleted');
    }
};

const closeModal = () => {
    clearTimeout(autoSaveTimer); // Ensure timer is cleared on close
    const modal = document.getElementById('bookmark-modal');
    modal.classList.add('hidden');
    modal.setAttribute('inert', '');
    document.removeEventListener('keydown', handleModalKeyDown);
    document.removeEventListener('click', handleModalClick, true);
};

const closeConfirmDeleteModal = () => {
    const modal = document.getElementById('confirm-delete-modal');
    modal.classList.add('hidden');
    modal.setAttribute('inert', '');
    document.removeEventListener('keydown', handleConfirmDeleteKeyDown, true);
};

const handleModalKeyDown = (event) => {
    if (event.key === 'Escape') {
        closeModal();
    } else if (event.key === 'Enter') {
        event.preventDefault();
        saveBookmark();
    } else {
        event.stopPropagation();
    }
};

const handleConfirmDeleteKeyDown = (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        document.getElementById('confirm-delete').click();
    } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeConfirmDeleteModal();
    } else {
        event.stopPropagation();
    }
};

const handleModalClick = (event) => {
    if (!document.getElementById('bookmark-modal').contains(event.target)) {
        event.stopPropagation();
    }
};

const updateStarColor = () => {
    const addBookmarkButton = document.getElementById('add-bookmark-modal');
    const addBookmarkButtonTop = document.getElementById('add-bookmark-modal-top');
    const isBookmarked = bookmarks.hasOwnProperty(pageNum);
    addBookmarkButton.style.color = isBookmarked ? 'blue' : 'black';
    addBookmarkButtonTop.style.color = isBookmarked ? 'blue' : 'black';
};

const setPdfDoc = (doc) => {
    pdfDoc = doc;
};

const prefetchPages = (currentPage, numPagesToPrefetch = 2) => {
    const startPage = currentPage + 1;
    const endPage = Math.min(currentPage + numPagesToPrefetch, pdfDoc.numPages);

    for (let page = startPage; page <= endPage; page++) {
        pdfDoc.getPage(page).then((page) => {
            const viewport = page.getViewport({ scale });
            const outputScale = window.devicePixelRatio || 1;
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(viewport.width * outputScale);
            canvas.height = Math.floor(viewport.height * outputScale);
            const ctx = canvas.getContext('2d');
            const renderCtx = {
                canvasContext: ctx,
                viewport,
                transform: [outputScale, 0, 0, outputScale, 0, 0]
            };
            page.render(renderCtx).promise.then(() => {
                cachePage(page.pageNumber, canvas.toDataURL());
            });
        });
        totalPrefetchedPages++;
    }
};

// Optimized page loading function
const loadPageWithPriority = async (pageNum, priority) => {
    if (currentLoadingPromises.has(pageNum)) {
        return currentLoadingPromises.get(pageNum);
    }

    const loadPromise = (async () => {
        try {
            if (pageCache.has(pageNum)) {
                return pageCache.get(pageNum);
            }

            pageStates.set(pageNum, PageState.LOADING);
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale });
            
            // For high priority, render immediately
            if (priority === 'high') {
                await renderPageToCanvas(page, viewport);
            }
            
            pageCache.set(pageNum, page);
            pageStates.set(pageNum, PageState.LOADED);
            return page;
        } catch (error) {
            pageStates.set(pageNum, PageState.ERROR);
            throw error;
        } finally {
            currentLoadingPromises.delete(pageNum);
        }
    })();

    currentLoadingPromises.set(pageNum, loadPromise);
    return loadPromise;
};

// Add this function near the other UI update functions
const updatePageInfo = (num) => {
    const pageInfo = document.getElementById('page-info');
    const pageInfoControls = document.getElementById('page-info-controls');
    
    if (pageInfo) {
        pageInfo.textContent = `Page ${num} of ${pdfDoc.numPages}`;
    }
    if (pageInfoControls) {
        pageInfoControls.textContent = `Page ${num} of ${pdfDoc.numPages}`;
    }
    updatePageProgress(num);
};

// Modify the existing renderPage function
const renderPage = async (num, scale) => {
    if (!pdfDoc) return;
    
    try {
        // Show loading state immediately
        canvas.style.opacity = '0.7';
        pageIsRendering = true;

        // Cancel any existing render
        if (renderTask) {
            renderTask.cancel();
        }

        // Load the page with high priority
        const page = await loadPageWithPriority(num, 'high');
        const viewport = page.getViewport({ scale });
        
        // Set up canvas
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        
        // Render page
        await renderPageToCanvas(page, viewport);
        
        // Queue next pages for loading
        queueAdjacentPages(num);
        
        // Update UI
        updatePageInfo(num);
        canvas.style.opacity = '1';
    } catch (error) {
        console.error('Error rendering page:', error);
        showToast('Error loading page');
    } finally {
        pageIsRendering = false;
    }
};

// Add helper function for rendering to canvas
const renderPageToCanvas = async (page, viewport) => {
    const outputScale = window.devicePixelRatio || 1;
    const renderContext = {
        canvasContext: ctx,
        viewport,
        transform: [outputScale, 0, 0, outputScale, 0, 0]
    };
    
    renderTask = page.render(renderContext);
    return renderTask.promise;
};

// Add function to queue adjacent pages
const queueAdjacentPages = (currentPage) => {
    // Clear existing queue
    loadQueue.clear(loadQueue.MEDIUM);
    
    // Queue next pages
    for (let i = 1; i <= PAGE_BUFFER_SIZE; i++) {
        const nextPage = currentPage + i;
        const prevPage = currentPage - i;
        
        if (nextPage <= pdfDoc.numPages) {
            loadQueue.add(nextPage, loadQueue.MEDIUM);
        }
        if (prevPage >= 1) {
            loadQueue.add(prevPage, loadQueue.MEDIUM);
        }
    }
};

// Move this function definition before loadPDFWithRetry
const updateLoadingProgress = (progress) => {
    const progressBar = document.querySelector('.loading-progress-bar');
    const loadingText = document.querySelector('.loading-text');
    if (progressBar && loadingText) {
        progressBar.style.transition = 'width 0.5s ease';
        const percentage = Math.min(Math.round(progress * 100), 100);
        progressBar.style.width = `${percentage}%`;
        loadingText.textContent = 'Please wait while we prepare your document...';
    }
};

// Update queueRenderPage to handle force render
const queueRenderPage = async (num, force = false) => {
    if (!isPdfReady || !pdfDoc) {
        const retryRender = () => {
            if (isPdfReady && pdfDoc) {
                queueRenderPage(num, force);
            } else {
                setTimeout(retryRender, 1000);
            }
        };
        retryRender();
        return;
    }

    const newPageNum = parseInt(num, 10);
    
    if (isNaN(newPageNum) || newPageNum < 1 || newPageNum > pdfDoc.numPages) {
        console.error('Invalid page number:', num);
        return;
    }

    // Only proceed if it's a different page or forced
    if (newPageNum !== pageNum || force) {
        pageNum = newPageNum;
        localStorage.setItem('lastPage', pageNum.toString());
        
        // Render the page immediately
        if (pageIsRendering) {
            pageNumPending = pageNum;
        } else {
            renderPage(pageNum, scale);
        }

        // Then sync with server if user is logged in
        if (auth.currentUser) {
            try {
                await updateLastRead(auth.currentUser.uid, pageNum);
            } catch (error) {
                console.error('Error syncing last read page:', error);
                showToast('Error syncing progress');
            }
        }
    }
};

const updatePageProgress = (num) => {
    const progress = (num / pdfDoc.numPages) * 100;
    document.getElementById('page-progress').style.width = `${progress}%`;
};

const resetCanvas = () => {
    canvas.width = 0;
    canvas.height = 0;
};

const loadPDFWithRetry = async (url, retries = 10, delay = 3000) => {
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
        loadingElement.innerHTML = `
            <div class="text-center p-4">
                <div class="spinner"></div>
                <p>Loading...</p>
            </div>
        `;
        loadingElement.style.display = 'flex';
    }

    while (true) {
        try {
            await new Promise(resolve => setTimeout(resolve, delay));
            const loadingTask = pdfjsLib.getDocument({
                url: url,
                cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/cmaps/',
                cMapPacked: true,
                enableXfa: true,
                disableRange: false,
                disableStream: false,
                disableAutoFetch: false,
                rangeChunkSize: 65536
            });

            const doc = await loadingTask.promise;
            isPdfReady = true;
            if (loadingElement) {
                loadingElement.style.display = 'none';
            }
            return doc;
        } catch (error) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

const setPageNum = (num) => {
    pageNum = parseInt(num, 10);
    localStorage.setItem('lastPage', pageNum.toString());
    return pageNum;
};

const initializePdf = async (initialPage = null) => {
    try {
        await openDB();
        pdfDoc = await loadPDFWithRetry('./assets/book.pdf');
        setPdfDoc(pdfDoc);
        
        if (initialPage) {
            setPageNum(initialPage);
        }
        
        if (isPdfReady && pdfDoc) {
            await renderPage(pageNum, scale);
            zoomIn();
        }
    } catch (error) {
        // Silently retry initialization
        setTimeout(() => initializePdf(initialPage), 2000);
    }
};

const jumpToPage = async () => {
    const pageInput = document.getElementById('page-input');
    const targetPage = parseInt(pageInput.value, 10);
    
    if (!isNaN(targetPage) && targetPage >= 1 && targetPage <= pdfDoc.numPages) {
        await pageNavigationManager.changePage(targetPage, { force: true });
    }
    
    pageInput.value = '';
};

const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
    setTimeout(() => renderPage(pageNum, scale), 100); // Re-render the page to adjust the canvas size after entering/exiting full-screen mode
};

const showNextPage = () => {
    if (!pdfDoc || !isPdfReady || pageChangeInProgress) return;
    if (pageNum >= pdfDoc.numPages) return;
    
    pageChangeInProgress = true;
    pageNum++;
    queueRenderPage(pageNum, true).finally(() => {
        pageChangeInProgress = false;
    });
};

const showPrevPage = () => {
    if (!pdfDoc || !isPdfReady || pageChangeInProgress) return;
    if (pageNum <= 1) return;
    
    pageChangeInProgress = true;
    pageNum--;
    queueRenderPage(pageNum, true).finally(() => {
        pageChangeInProgress = false;
    });
};

// Update zoomIn to handle initialization state better
const zoomIn = () => {
    if (!isPdfReady || !pdfDoc) {
        // Queue zoom for when PDF is ready instead of warning
        const checkAndZoom = () => {
            if (isPdfReady && pdfDoc) {
                scale += 0.25;
                queueRenderPage(pageNum, true); // Force re-render
                showToast('Image quality improved');
            } else {
                setTimeout(checkAndZoom, 500);
            }
        };
        checkAndZoom();
        return;
    }
    
    scale += 0.25;
    queueRenderPage(pageNum, true); // Force re-render
    showToast('Image quality improved');
};

const toggleBookmarks = () => {
    const bookmarkList = document.getElementById('bookmark-list');
    bookmarkList.classList.toggle('hidden');
};

const handleTouchStart = (evt) => {
    const firstTouch = evt.touches[0];
    xDown = firstTouch.clientX;
    yDown = firstTouch.clientY;
};

// Modified handleTouchMove function with lock to avoid double page change
const handleTouchMove = (evt) => {
    if (!xDown || !yDown || touchLock) return;
    touchLock = true;
    
    const xUp = evt.touches[0].clientX;
    const yUp = evt.touches[0].clientY;
    const xDiff = xDown - xUp;
    const yDiff = yDown - yUp;
    
    setTimeout(() => { touchLock = false; }, PAGE_CHANGE_DEBOUNCE);
    
    // Clear touch points immediately
    xDown = null;
    yDown = null;
    
    if (Math.abs(xDiff) > Math.abs(yDiff)) {
        if (xDiff > 50) { // Add threshold for better detection
            goToNextPage();
        } else if (xDiff < -50) {
            goToPreviousPage();
        }
    }
};

// Add the missing handlePageInputKeyDown function
const handlePageInputKeyDown = (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        jumpToPage();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const addBookmarkModalBtn = document.getElementById('add-bookmark-modal');
    const saveBookmarkBtn = document.getElementById('save-bookmark');
    const closeModalBtn = document.getElementById('close-modal');
    const closeConfirmDeleteModalBtn = document.getElementById('close-confirm-delete-modal');

    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => {
            if (pageNum <= 1) return;
            pageNum--;
            queueRenderPage(pageNum);
        });
    }

    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => {
            goToNextPage();  // Changed from nested logic to direct call
        });
    }

    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', () => {
            if (isPdfReady) {
                zoomIn();
            } else {
                console.warn('Waiting for PDF to load before zooming');
            }
        });
    }

    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', () => {
            if (scale <= 0.25) return;
            scale -= 0.25;
            queueRenderPage(pageNum);
        });
    }

    if (addBookmarkModalBtn) {
        addBookmarkModalBtn.addEventListener('click', addBookmarkModal);
    }

    if (saveBookmarkBtn) {
        saveBookmarkBtn.addEventListener('click', saveBookmark);
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeModal);
    }

    if (closeConfirmDeleteModalBtn) {
        closeConfirmDeleteModalBtn.addEventListener('click', closeConfirmDeleteModal);
    }

    openDB().then(() => {
        pdfjsLib.getDocument('./assets/book.pdf').promise.then((doc) => { // Update the path to your PDF file
            setPdfDoc(doc);
            queueRenderPage(pageNum); // Ensure the correct page is rendered
            updateBookmarkList();
        }).catch((error) => {
            console.error('Error loading PDF:', error);
        });
    });

    window.addEventListener('resize', () => {
        pageNum = parseInt(localStorage.getItem('lastPage'), 10) || pageNum; // Ensure the correct page is rendered when the screen size changes
        queueRenderPage(pageNum);
    });

    window.addEventListener('orientationchange', () => {
        pageNum = parseInt(localStorage.getItem('lastPage'), 10) || pageNum; // Ensure the correct page is rendered when the orientation changes
        resetCanvas(); // Reset the canvas
        queueRenderPage(pageNum);
    });

    document.addEventListener('touchstart', handleTouchStart, false);
    document.addEventListener('touchmove', handleTouchMove, false);

    const pdfViewer = document.getElementById('pdf-render');
    if (pdfViewer) {
        pdfViewer.style.zIndex = '1';
        pdfViewer.addEventListener('wheel', handleWheel, { 
            passive: true  // Keep passive true but remove capture: false
        });
        // ...rest of event listeners...
    }
    
    // Add CSS to prevent default scrolling on the PDF viewer
    pdfViewer.style.overflowY = 'hidden';
    pdfViewer.style.touchAction = 'none';
    
    // ...rest of existing code...
    
    pdfViewer.addEventListener('mousedown', handleMouseUpDown); // Use the local reference
    pdfViewer.ondblclick = toggleFullScreen;
    
    // Initialize bookmarks
    window.bookmarks = window.bookmarks || {};
    updateBookmarkList();

    // Update button handlers
    const prevPageBtnControl = document.getElementById('prev-page-btn');
    const nextPageBtnControl = document.getElementById('next-page-btn');

    // Navigation buttons
    [prevPageBtn, prevPageBtnControl].forEach(btn => {
        if (btn) btn.addEventListener('click', goToPreviousPage);
    });

    [nextPageBtn, nextPageBtnControl].forEach(btn => {
        if (btn) btn.addEventListener('click', goToNextPage);
    });

    // Keyboard navigation
    document.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight' || event.key === 'PageDown') {
            goToNextPage();
        } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
            goToPreviousPage();
        }
    });
});

// Single export statement
export { 
    openDB, 
    setPdfDoc, 
    renderPage, 
    queueRenderPage, 
    updateBookmarkList, 
    jumpToBookmark, 
    addBookmarkModal, 
    saveBookmark, 
    editBookmark, 
    confirmDeleteBookmark, 
    deleteBookmark, 
    closeModal, 
    closeConfirmDeleteModal, 
    updateStarColor, 
    jumpToPage, 
    toggleFullScreen, 
    zoomIn, 
    toggleBookmarks,
    handleModalKeyDown,
    handleWheel,
    handleMouseUpDown,
    setPageNum,
    initializePdf,
    goToNextPage,
    goToPreviousPage,
    handlePageInputKeyDown
};

// Single window object assignment
Object.assign(window, {
    deleteBookmark,
    handleMouseUpDown,
    goToNextPage,
    goToPreviousPage,
    jumpToBookmark,
    editBookmark,
    confirmDeleteBookmark,
    // Add these functions to make them globally available
    saveBookmark,
    closeModal,
    updateBookmarkList,
    closeConfirmDeleteModal,
    handleModalKeyDown,
    handlePageInputKeyDown,
    jumpToPage,
    jumpToBookmark   // Ensure jumpToBookmark is explicitly added
});