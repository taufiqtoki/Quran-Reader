const dbName = 'pdfCacheDB', storeName = 'pages';
let db, pdfDoc = null, pageIsRendering = false, pageNumPending = null, scale = window.devicePixelRatio || 1;
const canvas = document.getElementById('pdf-render'), ctx = canvas.getContext('2d');
let renderTask = null, bookmarks = JSON.parse(localStorage.getItem('bookmarks')) || {}, pageNum = localStorage.getItem('lastPage') ? parseInt(localStorage.getItem('lastPage'), 10) : 1;
let autoSaveTimer;

let totalPrefetchedPages = 0;
let totalCachedPages = 0;
let totalRenderedPages = 0;

const MAX_CACHED_PAGES = 50; // Limit the number of cached pages

let xDown = null, yDown = null; // Add these variables at the top of the file
let touchLock = false;  // added flag to prevent double triggering

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
    bookmarkList.innerHTML = '';
    Object.keys(bookmarks).sort((a, b) => a - b).forEach((page) => {
        const bookmark = bookmarks[page];
        if (bookmark) { // Add check to skip null values
            const li = document.createElement('li');
            li.className = 'flex justify-between items-center bg-gray-200 px-4 py-2 rounded';
            li.innerHTML = `<span class="cursor-pointer" onclick="jumpToBookmark(${page})">${bookmark.name} (Page ${page})</span>
                <div class="flex space-x-2">
                    <button class="text-blue-500" onclick="editBookmark(${page})"><i class="fas fa-edit"></i></button>
                    <button class="text-red-500" onclick="confirmDeleteBookmark(${page})"><i class="fas fa-trash-alt"></i></button>
                </div>`;
            bookmarkList.appendChild(li);
        }
    });
    localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
};

const jumpToBookmark = (page) => {
    pageNum = page;
    queueRenderPage(pageNum);
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
    startAutoSaveTimer(); // Start the auto-save timer
};

const saveBookmark = () => {
    const page = parseInt(document.getElementById('modal-page-number').value, 10);
    const name = document.getElementById('modal-bookmark-name').value.trim();
    if (!page || !name) return;
    bookmarks[page] = { name };
    updateBookmarkList();
    closeModal();
    updateStarColor();
    showToast('Bookmark saved');
    clearTimeout(autoSaveTimer); // Clear the auto-save timer
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

const deleteBookmark = (page) => {
    delete bookmarks[page];
    updateBookmarkList();
    showToast('Bookmark deleted');
};

const closeModal = () => {
    const modal = document.getElementById('bookmark-modal');
    modal.classList.add('hidden');
    modal.setAttribute('inert', '');
    document.removeEventListener('keydown', handleModalKeyDown);
    document.removeEventListener('click', handleModalClick, true);
    clearTimeout(autoSaveTimer); // Clear the auto-save timer
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

const renderPage = (num, scale) => {
    if (!pdfDoc) return;
    if (renderTask) renderTask.cancel();
    pageIsRendering = true;
    const loadingElement = document.getElementById('loading');
    if (loadingElement) loadingElement.style.display = 'flex';
    canvas.style.visibility = 'hidden'; // Hide the canvas until rendering is complete
    pdfDoc.getPage(num).then((page) => {
        const viewport = page.getViewport({ scale });
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear the canvas before rendering
        const renderCtx = {
            canvasContext: ctx,
            viewport,
            transform: [outputScale, 0, 0, outputScale, 0, 0]
        };
        renderTask = page.render(renderCtx);
        renderTask.promise.then(() => {
            pageIsRendering = false;
            canvas.style.visibility = 'visible'; // Show the canvas after rendering is complete
            if (loadingElement) loadingElement.style.display = 'none';
            if (pageNumPending !== null) {
                renderPage(pageNumPending, scale);
                pageNumPending = null;
            }
            cachePage(num, canvas.toDataURL());
            totalRenderedPages++;
            updatePageProgress(num);
            prefetchPages(num, 2); // Prefetch the next 2 pages
            document.getElementById('page-info').textContent = `Page ${num} of ${pdfDoc.numPages}`;
            document.getElementById('page-info-controls').textContent = `Page ${num} of ${pdfDoc.numPages}`;
            localStorage.setItem('lastPage', num); // Update the last read page in local storage
            updateStarColor();
        }).catch((error) => {
            if (error.name === 'RenderingCancelledException') {
                pageIsRendering = false;
                if (pageNumPending !== null) {
                    renderPage(pageNumPending, scale);
                    pageNumPending = null;
                }
            }
        });
        document.getElementById('page-info').textContent = `Page ${num} of ${pdfDoc.numPages}`;
        localStorage.setItem('lastPage', num); // Update the last read page in local storage
        updateStarColor();
    });
};

const queueRenderPage = (num) => {
    pageNum = num; // Update the current page number
    localStorage.setItem('lastPage', pageNum); // Store the current page number in local storage
    if (pageIsRendering) {
        pageNumPending = num;
    } else {
        renderPage(num, scale);
    }
};

const updatePageProgress = (num) => {
    const progress = (num / pdfDoc.numPages) * 100;
    document.getElementById('page-progress').style.width = `${progress}%`;
};

const showToast = (message) => {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
};

const resetCanvas = () => {
    canvas.width = 0;
    canvas.height = 0;
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
            if (pageNum >= pdfDoc.numPages) return;
            pageNum++;
            queueRenderPage(pageNum);
        });
    }

    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', () => {
            scale += 0.25;
            queueRenderPage(pageNum);
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
});

const jumpToPage = () => {
    const pageInput = document.getElementById('page-input');
    const page = parseInt(pageInput.value, 10);
    if (isNaN(page) || page < 1 || page > pdfDoc.numPages) {
        return; // Silently fail without logging an error
    }
    pageNum = page;
    queueRenderPage(pageNum);
    pageInput.value = ''; // Clear the textbox
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
    if (pageNum >= pdfDoc.numPages) return;
    pageNum++;
    queueRenderPage(pageNum);
};

const showPrevPage = () => {
    if (pageNum <= 1) return;
    pageNum--;
    queueRenderPage(pageNum);
};

const zoomIn = () => {
    scale += 0.25;
    queueRenderPage(pageNum);
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
    const xUp = evt.touches[0].clientX, yUp = evt.touches[0].clientY;
    const xDiff = xDown - xUp, yDiff = yDown - yUp;
    if (Math.abs(xDiff) > Math.abs(yDiff)) {
        // horizontal swipe: change page
        if (xDiff > 0) showNextPage();
        else showPrevPage();
    } else {
        // vertical swipe: change page based on swipe direction
        if (yDiff > 0) showNextPage();
        else showPrevPage();
    }
    // Reset touch positions and lock after a short delay
    xDown = null; 
    yDown = null;
    setTimeout(() => { touchLock = false; }, 300);
};

// Ensure all necessary functions are exported
export { openDB, setPdfDoc, renderPage, queueRenderPage, updateBookmarkList, jumpToBookmark, addBookmarkModal, saveBookmark, editBookmark, confirmDeleteBookmark, deleteBookmark, closeModal, closeConfirmDeleteModal, updateStarColor, jumpToPage, toggleFullScreen, showNextPage, showPrevPage, zoomIn, toggleBookmarks };
