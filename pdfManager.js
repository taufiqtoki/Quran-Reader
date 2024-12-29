const dbName = 'pdfCacheDB', storeName = 'pages';
let db, pdfDoc = null, pageIsRendering = false, pageNumPending = null, scale = 1;
const canvas = document.getElementById('pdf-render'), ctx = canvas.getContext('2d');
let renderTask = null, bookmarks = JSON.parse(localStorage.getItem('bookmarks')) || {}, pageNum = localStorage.getItem('lastPage') ? parseInt(localStorage.getItem('lastPage'), 10) : 1;

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
};

const deleteCachedPage = (page) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    store.delete(page);
};

const updateBookmarkList = () => {
    const bookmarkList = document.getElementById('bookmark-list');
    bookmarkList.innerHTML = '';
    Object.keys(bookmarks).forEach((page) => {
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

const addBookmarkModal = () => {
    document.getElementById('modal-page-number').value = pageNum;
    document.getElementById('modal-bookmark-name').value = 'Continue';
    const modal = document.getElementById('bookmark-modal');
    modal.classList.remove('hidden');
    modal.removeAttribute('inert');
    document.addEventListener('keydown', handleModalKeyDown);
    document.addEventListener('click', handleModalClick, true);
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
    };
    document.getElementById('bookmark-modal').onkeydown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            saveButton.click();
        }
    };
};

const confirmDeleteBookmark = (page) => {
    const modal = document.getElementById('confirm-delete-modal');
    modal.classList.remove('hidden');
    modal.removeAttribute('inert');
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
};

const closeConfirmDeleteModal = () => {
    const modal = document.getElementById('confirm-delete-modal');
    modal.classList.add('hidden');
    modal.setAttribute('inert', '');
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

const handleModalClick = (event) => {
    if (!document.getElementById('bookmark-modal').contains(event.target)) {
        event.stopPropagation();
    }
};

const updateStarColor = () => {
    const addBookmarkButton = document.getElementById('add-bookmark-modal');
    const isBookmarked = bookmarks.hasOwnProperty(pageNum);
    addBookmarkButton.style.color = isBookmarked ? 'blue' : 'black';
};

const setPdfDoc = (doc) => {
    pdfDoc = doc;
};

const renderPage = (num) => {
    if (!pdfDoc) return;
    if (renderTask) renderTask.cancel();
    pageIsRendering = true;
    const loadingElement = document.getElementById('loading');
    if (loadingElement) loadingElement.style.display = 'flex';
    pdfDoc.getPage(num).then((page) => {
        const viewport = page.getViewport({ scale });
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        const renderCtx = {
            canvasContext: ctx,
            viewport,
            transform: [outputScale, 0, 0, outputScale, 0, 0]
        };
        renderTask = page.render(renderCtx);
        renderTask.promise.then(() => {
            pageIsRendering = false;
            if (loadingElement) loadingElement.style.display = 'none';
            if (pageNumPending !== null) {
                renderPage(pageNumPending);
                pageNumPending = null;
            }
            deleteCachedPage(num);
            cachePage(num, canvas.toDataURL());
        }).catch((error) => {
            if (error.name === 'RenderingCancelledException') {
                pageIsRendering = false;
                if (pageNumPending !== null) {
                    renderPage(pageNumPending);
                    pageNumPending = null;
                }
            }
        });
        document.getElementById('page-info').textContent = `Page ${num} of ${pdfDoc.numPages}`;
        localStorage.setItem('lastPage', num);
        updateStarColor();
    });
};

const queueRenderPage = (num) => {
    if (pageIsRendering) {
        pageNumPending = num;
    } else {
        renderPage(num);
    }
};

const showPrevPage = () => {
    if (pageNum <= 1) return;
    pageNum--;
    queueRenderPage(pageNum);
};

const showNextPage = () => {
    if (pageNum >= pdfDoc.numPages) return;
    pageNum++;
    queueRenderPage(pageNum);
};

const jumpToPage = () => {
    const pageInput = document.getElementById('page-input');
    const page = parseInt(pageInput.value, 10);
    if (page >= 1 && page <= pdfDoc.numPages) {
        const loadingElement = document.getElementById('loading');
        if (loadingElement) loadingElement.style.display = 'flex';
        pageNum = page;
        queueRenderPage(pageNum);
    }
};

const zoomIn = () => {
    scale += 0.1;
    queueRenderPage(pageNum);
};

const zoomOut = () => {
    if (scale > 0.2) {
        scale -= 0.1;
        queueRenderPage(pageNum);
    }
};

const resetZoom = () => {
    scale = 1;
    queueRenderPage(pageNum);
};

const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
    setTimeout(() => renderPage(pageNum), 100); // Re-render the page to adjust the canvas size after entering/exiting full-screen mode
};

const showToast = (message) => {
    const toastContainer = document.getElementById('toast-container');
    toastContainer.innerHTML = ''; // Clear existing toasts
    const toast = document.createElement('div');
    toast.className = 'toast bg-green-500 text-white px-4 py-2 rounded shadow-md';
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                toast.remove();
            }, 500);
        }, 3000);
    }, 100);
};

export { openDB, setPdfDoc, renderPage, queueRenderPage, showPrevPage, showNextPage, jumpToPage, zoomIn, zoomOut, resetZoom, updateBookmarkList, jumpToBookmark, addBookmarkModal, saveBookmark, editBookmark, confirmDeleteBookmark, deleteBookmark, closeModal, closeConfirmDeleteModal, updateStarColor, toggleFullScreen };
