import { auth, syncBookmarks } from './auth.js';
import { showToast } from './utils.js';
import { addBookmark, updateLastRead, deleteBookmark as deleteFirestoreBookmark } from './firestoreManager.js';

const dbName = 'pdfCacheDB', storeName = 'pages';
let db, pdfDoc = null, pageIsRendering = false, pageNumPending = null, scale = window.devicePixelRatio || 1;
const canvas = document.getElementById('pdf-render'), ctx = canvas.getContext('2d');
let renderTask = null, bookmarks = JSON.parse(localStorage.getItem('bookmarks')) || {}, pageNum = localStorage.getItem('lastPage') ? parseInt(localStorage.getItem('lastPage'), 10) : 1;
let autoSaveTimer;
let debounceTimeout;
window.isManualBookmarkInteraction = false;

const MAX_CACHED_PAGES = 50;
const PAGE_BUFFER_SIZE = 2;

const PageState = {
    UNLOADED: 0,
    LOADING: 1,
    LOADED: 2,
    RENDERED: 3,
    ERROR: 4
};

let totalCachedPages = 0;
let totalPrefetchedPages = 0;
let totalRenderedPages = 0;

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
        for (const page of this.queues.high) {
            await loadPageWithPriority(page, this.HIGH);
            this.queues.high.delete(page);
        }
        
        for (const page of this.queues.medium) {
            loadPageWithPriority(page, this.MEDIUM);
            this.queues.medium.delete(page);
        }
    }
};

const backgroundQueue = {
    tasks: [],
    isProcessing: false,
    
    add(task) {
        this.tasks.push(task);
        if (!this.isProcessing) {
            this.process();
        }
    },
    
    async process() {
        if (this.isProcessing || this.tasks.length === 0) return;
        
        this.isProcessing = true;
        while (this.tasks.length > 0) {
            const task = this.tasks.shift();
            try {
                await task();
            } catch (error) {
                console.error('Background task error:', error);
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        this.isProcessing = false;
    }
};

let isPdfReady = false;
let isPageChanging = false;
let pageChangeQueue = [];
const PAGE_CHANGE_DEBOUNCE = 300;

const pageLoadStates = {
    promises: new Map(),
    cache: new Map(),
    states: new Map()
};

let currentLoadingPromises = new Map();
let pageCache = new Map();
let pageStates = new Map();

// Add global state to track page changes
let isChangingPage = false;

const pageNavigationManager = {
    async changePage(newPage, options = {}) {
        if (isChangingPage && !options.force) {
            return;
        }

        isChangingPage = true;
        
        try {
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
                localStorage.setItem('lastPage', pageNum);
                
                this.updateDisplayInfo();
                
                await queueRenderPage(pageNum, true);
                
                updateBookmarkList();
                updateStarColor();

                if (auth.currentUser) {
                    backgroundQueue.add(async () => {
                        try {
                            await updateLastRead(auth.currentUser.uid, pageNum);
                        } catch (error) {
                            console.error('Background sync error:', error);
                        }
                    });
                }

            } catch (error) {
                console.error('Page change error:', error);
            } finally {
                isPageChanging = false;
                if (pageChangeQueue.length > 0) {
                    const nextChange = pageChangeQueue.pop();
                    pageChangeQueue = [];
                    nextChange();
                }
            }
        } finally {
            setTimeout(() => {
                isChangingPage = false;
            }, PAGE_CHANGE_DEBOUNCE);
        }
    },

    updateDisplayInfo() {
        requestAnimationFrame(() => {
            document.getElementById('page-info').textContent = `Page ${pageNum} of ${pdfDoc.numPages}`;
            document.getElementById('page-info-controls').textContent = `Page ${pageNum} of ${pdfDoc.numPages}`;
            updatePageProgress(pageNum);
        });
    }
};

const goToNextPage = async () => {
    if (!pdfDoc || !isPdfReady) return;
    await pageNavigationManager.changePage(pageNum + 1);
};

const goToPreviousPage = async () => {
    if (!pdfDoc || !isPdfReady) return;
    await pageNavigationManager.changePage(pageNum - 1);
};

// Update wheel handler - Fix double page change
const handleWheel = (event) => {
    if (!pdfDoc || isPageChanging || isChangingPage) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    // Ignore very small movements
    if (Math.abs(event.deltaY) < 10) return;
    
    // Clear pending timeouts
    if (debounceTimeout) {
        clearTimeout(debounceTimeout);
        return; // Exit immediately if there's a pending timeout
    }
    
    debounceTimeout = setTimeout(() => {
        // Use wheel delta to determine direction
        const direction = Math.sign(event.deltaY);
        
        if (direction > 0 && pageNum < pdfDoc.numPages) {
            goToNextPage();
        } else if (direction < 0 && pageNum > 1) {
            goToPreviousPage();
        }
        
        debounceTimeout = null;
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
    if (!db) return;
    
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    store.put({ page, dataUrl });
    totalCachedPages++;

    if (totalCachedPages > MAX_CACHED_PAGES) {
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

const logBookmarks = () => {
    console.log('Current bookmarks:', window.bookmarks);
};

const updateBookmarkList = () => {
    const bookmarkList = document.getElementById('bookmark-list');
    if (!bookmarkList) return;

    logBookmarks();
    
    bookmarkList.innerHTML = '';
    
    const bookmarkEntries = [];
    
    for (const [page, bookmark] of Object.entries(window.bookmarks)) {
        if (bookmark && bookmark.name) {
            bookmarkEntries.push({
                page: parseInt(page, 10),
                name: bookmark.name,
                id: bookmark.id
            });
        }
    }

    bookmarkEntries.sort((a, b) => a.page - b.page);

    bookmarkEntries.forEach(bookmark => {
        const li = document.createElement('li');
        li.className = 'flex justify-between items-center bg-gray-200 px-4 py-2 rounded mb-2';
        li.innerHTML = `
            <span class="cursor-pointer" onclick="jumpToBookmark(${bookmark.page})">
                ${bookmark.name} (Page ${bookmark.page})
            </span>
            <div class="flex space-x-2">
                <button class="text-blue-500" onclick="editBookmark(${bookmark.page})">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="text-red-500" onclick="confirmDeleteBookmark(${bookmark.page})">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;
        bookmarkList.appendChild(li);
    });

    console.log('Displayed bookmarks:', bookmarkEntries);
    
    updateStarColor();
};

const jumpToBookmark = async (page) => {
    if (!pdfDoc || !isPdfReady) return;
    await pageNavigationManager.changePage(parseInt(page, 10), { force: true });
};

const startAutoSaveTimer = () => {
    if (isManualBookmarkInteraction) return;
    
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
        if (!isManualBookmarkInteraction) {
            saveBookmark();
        }
    }, 10000);
};

const addBookmarkModal = () => {
    isManualBookmarkInteraction = true;
    clearTimeout(autoSaveTimer);
    
    document.getElementById('modal-page-number').value = pageNum;
    document.getElementById('modal-bookmark-name').value = bookmarks[pageNum] ? bookmarks[pageNum].name : 'Continue';
    const modal = document.getElementById('bookmark-modal');
    modal.classList.remove('hidden');
    modal.removeAttribute('inert');
    document.addEventListener('keydown', handleModalKeyDown);
    document.addEventListener('click', handleModalClick, true);
    
    const saveButton = document.getElementById('save-bookmark');
    if (!saveButton && !isManualBookmarkInteraction) {
        startAutoSaveTimer();
    }

    const nameInput = document.getElementById('modal-bookmark-name');
    nameInput.addEventListener('input', () => {
        clearTimeout(autoSaveTimer);
        isManualBookmarkInteraction = true;
    });
};

const isExactDuplicate = (page, name) => {
    const existingBookmarks = Object.entries(window.bookmarks || {});
    return existingBookmarks.some(([existingPage, bookmark]) => 
        parseInt(existingPage) === page && 
        bookmark.name.toLowerCase() === name.toLowerCase()
    );
};

const saveBookmark = async () => {
    clearTimeout(autoSaveTimer);
    isManualBookmarkInteraction = false;
    
    const page = parseInt(document.getElementById('modal-page-number').value, 10);
    const name = document.getElementById('modal-bookmark-name').value.trim();
    if (!page || !name) return;

    if (isExactDuplicate(page, name)) {
        showToast('This exact bookmark already exists');
        return;
    }

    try {
        window.bookmarks[page] = { name };
        localStorage.setItem('bookmarks', JSON.stringify(window.bookmarks));
        updateBookmarkList();
        closeModal();
        showToast(`Bookmark '${name}' saved at page ${page}`);

        if (auth.currentUser) {
            backgroundQueue.add(async () => {
                try {
                    const bookmarkId = await addBookmark(auth.currentUser.uid, name, page);
                    window.bookmarks[page].id = bookmarkId;
                    localStorage.setItem('bookmarks', JSON.stringify(window.bookmarks));
                } catch (error) {
                    console.error('Background bookmark sync error:', error);
                }
            });
        }
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
        clearTimeout(autoSaveTimer);
    };
    document.getElementById('bookmark-modal').onkeydown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            saveButton.click();
        }
    };
    startAutoSaveTimer();
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

    delete window.bookmarks[page];
    localStorage.setItem('bookmarks', JSON.stringify(window.bookmarks));
    updateBookmarkList();
    
    console.log('Bookmark deleted locally');
    
    if (auth.currentUser && bookmark.id) {
        backgroundQueue.add(async () => {
            try {
                console.log('Attempting server deletion:', bookmark.id);
                await deleteFirestoreBookmark(auth.currentUser.uid, bookmark.id);
                console.log('Server deletion successful');
                showToast('Bookmark deleted');
            } catch (error) {
                console.error('Server deletion failed:', error);
                window.bookmarks[page] = bookmark;
                localStorage.setItem('bookmarks', JSON.stringify(window.bookmarks));
                updateBookmarkList();
                showToast('Error deleting bookmark from server');
            }
        });
    } else {
        showToast('Bookmark deleted');
    }
};

const closeModal = () => {
    clearTimeout(autoSaveTimer);
    isManualBookmarkInteraction = false;
    
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

const renderPage = async (num, scale) => {
    if (!pdfDoc) return;
    
    try {
        canvas.style.opacity = '0.7';
        pageIsRendering = true;

        if (renderTask) {
            renderTask.cancel();
        }

        const page = await loadPageWithPriority(num, 'high');
        const viewport = page.getViewport({ scale });
        
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        
        await renderPageToCanvas(page, viewport);
        
        queueAdjacentPages(num);
        
        updatePageInfo(num);
        canvas.style.opacity = '1';
    } catch (error) {
        console.error('Error rendering page:', error);
        showToast('Error loading page');
    } finally {
        pageIsRendering = false;
    }
};

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

const queueAdjacentPages = (currentPage) => {
    loadQueue.clear(loadQueue.MEDIUM);
    
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

    if (newPageNum !== pageNum || force) {
        pageNum = newPageNum;
        localStorage.setItem('lastPage', pageNum.toString());
        
        if (pageIsRendering) {
            pageNumPending = pageNum;
        } else {
            renderPage(pageNum, scale);
        }

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
        setTimeout(() => initializePdf(initialPage), 2000);
    }
};

const jumpToPage = async () => {
    const pageInput = document.getElementById('page-input');
    const targetPage = parseInt(pageInput.value, 10);
    
    // Clear input before validation to avoid false "invalid" message
    const inputValue = pageInput.value;
    pageInput.value = '';
    
    if (!isNaN(targetPage) && targetPage >= 1 && targetPage <= pdfDoc.numPages) {
        await pageNavigationManager.changePage(targetPage, { force: true });
        showToast(`Jumped to page ${targetPage}`);
    } else if (inputValue) { // Only show invalid message if there was input
        showToast('Invalid page number');
    }
};

const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
    setTimeout(() => renderPage(pageNum, scale), 100);
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

const zoomIn = () => {
    if (!isPdfReady || !pdfDoc) {
        const checkAndZoom = () => {
            if (isPdfReady && pdfDoc) {
                scale += 0.25;
                queueRenderPage(pageNum, true);
                showToast('Image quality improved');
            } else {
                setTimeout(checkAndZoom, 500);
            }
        };
        checkAndZoom();
        return;
    }
    
    scale += 0.25;
    queueRenderPage(pageNum, true);
    showToast('Image quality improved');
};

const toggleBookmarks = () => {
    const bookmarkList = document.getElementById('bookmark-list');
    bookmarkList.classList.toggle('hidden');
};

let xDown = null;
let yDown = null;
let touchLock = false;

// Add these touch state variables near the top with other state variables
let touchStartX = null;
let touchStartY = null;
let touchEndX = null;
let touchEndY = null;
const SWIPE_THRESHOLD = 50;

// Update touch handlers to only respond to horizontal swipes
const handleTouchStart = (evt) => {
    const touch = evt.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchEndX = touchStartX;
    touchEndY = touchStartY;
};

const handleTouchMove = (evt) => {
    if (!touchStartX || !touchStartY) return;
    
    touchEndX = evt.touches[0].clientX;
    touchEndY = evt.touches[0].clientY;
};

// Updated handleTouchEnd to add vertical swipe page change
const handleTouchEnd = (evt) => {
    if (!touchStartX || !touchStartY || !touchEndX || !touchEndY) return;
    
    const xDiff = touchStartX - touchEndX;
    const yDiff = touchStartY - touchEndY;
    
    // Determine swipe direction based on greater movement
    if (Math.abs(xDiff) > Math.abs(yDiff) && Math.abs(xDiff) > SWIPE_THRESHOLD) {
        // Horizontal swipe
        if (xDiff > 0 && pageNum < pdfDoc.numPages) {
            goToNextPage();
        } else if (xDiff < 0 && pageNum > 1) {
            goToPreviousPage();
        }
    } else if (Math.abs(yDiff) > Math.abs(xDiff) && Math.abs(yDiff) > SWIPE_THRESHOLD) {
        // Vertical swipe
        if (yDiff > 0 && pageNum < pdfDoc.numPages) {
            // Swipe up: move to next page
            goToNextPage();
        } else if (yDiff < 0 && pageNum > 1) {
            // Swipe down: move to previous page
            goToPreviousPage();
        }
    }
    
    // Reset touch points
    touchStartX = touchStartY = touchEndX = touchEndY = null;
};

const handlePageInputKeyDown = (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        jumpToPage();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    
    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (pageNum <= 1) return;
            goToPreviousPage();
        });
    }

    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (pageNum >= pdfDoc.numPages) return;
            goToNextPage();
        });
    }

    const prevPageBtnControl = document.getElementById('prev-page-btn');
    const nextPageBtnControl = document.getElementById('next-page-btn');

    if (prevPageBtnControl) {
        prevPageBtnControl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (pageNum <= 1) return;
            goToPreviousPage();
        });
    }

    if (nextPageBtnControl) {
        nextPageBtnControl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (pageNum >= pdfDoc.numPages) return;
            goToNextPage();
        });
    }

    // Update keyboard navigation
    document.addEventListener('keydown', (event) => {
        if (isChangingPage) return;
        
        // Don't prevent default for inputs
        if (event.target.tagName === 'INPUT' || 
            event.target.tagName === 'TEXTAREA' || 
            event.target.isContentEditable) {
            return;
        }

        if (event.repeat) return;

        if (event.key === 'ArrowRight' || event.key === 'PageDown') {
            event.preventDefault();
            if (pageNum >= pdfDoc.numPages) return;
            goToNextPage();
        } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
            event.preventDefault();
            if (pageNum <= 1) return;
            goToPreviousPage();
        }
    });

    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const addBookmarkModalBtn = document.getElementById('add-bookmark-modal');
    const saveBookmarkBtn = document.getElementById('save-bookmark');
    const closeModalBtn = document.getElementById('close-modal');
    const closeConfirmDeleteModalBtn = document.getElementById('close-confirm-delete-modal');

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
        pdfjsLib.getDocument('./assets/book.pdf').promise.then((doc) => {
            setPdfDoc(doc);
            queueRenderPage(pageNum);
            updateBookmarkList();
        }).catch((error) => {
            console.error('Error loading PDF:', error);
        });
    });

    window.addEventListener('resize', () => {
        pageNum = parseInt(localStorage.getItem('lastPage'), 10) || pageNum;
        queueRenderPage(pageNum);
    });

    window.addEventListener('orientationchange', () => {
        pageNum = parseInt(localStorage.getItem('lastPage'), 10) || pageNum;
        resetCanvas();
        queueRenderPage(pageNum);
    });

    // Update touch event listeners with capture
    document.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true, capture: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true });

    const pdfViewer = document.getElementById('pdf-render');
    if (pdfViewer) {
        pdfViewer.style.zIndex = '1';
        // Update wheel event listener
        pdfViewer.addEventListener('wheel', handleWheel, { 
            passive: false,
            capture: true // Ensure we capture the event first
        });
    }
    
    pdfViewer.style.overflowY = 'hidden';
    pdfViewer.style.touchAction = 'none';
    
    pdfViewer.addEventListener('mousedown', handleMouseUpDown);
    pdfViewer.ondblclick = toggleFullScreen;
    
    window.bookmarks = window.bookmarks || {};
    updateBookmarkList();

    [prevPageBtn, prevPageBtnControl].forEach(btn => {
        if (btn) btn.addEventListener('click', goToPreviousPage);
    });

    [nextPageBtn, nextPageBtnControl].forEach(btn => {
        if (btn) btn.addEventListener('click', goToNextPage);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight' || event.key === 'PageDown') {
            goToNextPage();
        } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
            goToPreviousPage();
        }
    });

    const addNavButtonHandler = (btn, action) => {
        if (!btn) return;
        
        btn.replaceWith(btn.cloneNode(true));
        
        const newBtn = document.getElementById(btn.id);
        if (!newBtn) return;

        let timeoutId;
        newBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            
            if (timeoutId) return;
            
            timeoutId = setTimeout(() => {
                action();
                timeoutId = null;
            }, 300);
        });
    };

    addNavButtonHandler(document.getElementById('prev-page'), goToPreviousPage);
    addNavButtonHandler(document.getElementById('next-page'), goToNextPage);
    addNavButtonHandler(document.getElementById('prev-page-btn'), goToPreviousPage);
    addNavButtonHandler(document.getElementById('next-page-btn'), goToNextPage);

    const pageInput = document.getElementById('page-input');
    const goToPageBtn = document.getElementById('go-to-page');

    if (pageInput) {
        pageInput.replaceWith(pageInput.cloneNode(true));
        const newPageInput = document.getElementById('page-input');
        
        // Only handle Enter key and sanitize input
        newPageInput.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
                event.preventDefault();
                jumpToPage();
            }
        });

        // Just sanitize input, remove auto-jump
        newPageInput.addEventListener('input', (event) => {
            event.target.value = event.target.value.replace(/[^0-9]/g, '');
        });

        newPageInput.addEventListener('focus', () => {
            document.removeEventListener('keydown', handleKeyDown);
        });

        newPageInput.addEventListener('blur', () => {
            document.addEventListener('keydown', handleKeyDown);
        });
    }

    if (goToPageBtn) {
        goToPageBtn.replaceWith(goToPageBtn.cloneNode(true));
        const newGoToPageBtn = document.getElementById('go-to-page');
        newGoToPageBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            jumpToPage();
        });
    }
});

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
    handlePageInputKeyDown,
    backgroundQueue
};

Object.assign(window, {
    deleteBookmark,
    handleMouseUpDown,
    goToNextPage,
    goToPreviousPage,
    jumpToBookmark,
    editBookmark,
    confirmDeleteBookmark,
    saveBookmark,
    closeModal,
    updateBookmarkList,
    closeConfirmDeleteModal,
    handleModalKeyDown,
    handlePageInputKeyDown,
    jumpToPage,
    jumpToBookmark
});