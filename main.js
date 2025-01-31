import { openDB, setPdfDoc, renderPage, queueRenderPage, showPrevPage, showNextPage, jumpToPage, zoomIn, updateBookmarkList, addBookmarkModal, saveBookmark, closeModal, jumpToBookmark, editBookmark, deleteBookmark, confirmDeleteBookmark, toggleFullScreen, updateStarColor } from './pdfManager.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

const url = './assets/book.pdf';
let pdfDoc = null;
let pageNum = localStorage.getItem('lastPage') ? parseInt(localStorage.getItem('lastPage'), 10) : 1;
let scale = window.devicePixelRatio || 1;

openDB().then(() => {
    pdfjsLib.getDocument(url).promise.then((pdfDoc_) => {
        pdfDoc = pdfDoc_;
        setPdfDoc(pdfDoc);
        renderPage(pageNum, scale); // Render the initial page
    });
});

let xDown = null, yDown = null, focusedElement = null, debounceTimeout;
let wakeLock = null;
let wakeLockInterval = null;

const setFocus = (element) => { focusedElement = element; };
const clearFocus = (element) => { if (focusedElement === element) focusedElement = null; };

const debounce = (func, delay) => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(func, delay);
};

const handleKeyDown = (event) => {
    if (document.getElementById('bookmark-modal').classList.contains('hidden')) {
        debounce(() => {
            if (event.ctrlKey && event.key === 'b') {
                addBookmarkModal();
            } else if (event.ctrlKey && event.key === ' ') {
                addBookmarkModal();
            } else if (event.ctrlKey && event.key === 'Enter') {
                toggleFullScreen();
            } else if (event.key === '*') {
                addBookmarkModal();
            } else if (event.key === '-' && event.repeat && event.getModifierState('Shift')) {
                const controlSection = document.getElementById('control-section');
                controlSection.classList.toggle('hidden');
                controlSection.style.backgroundColor = controlSection.classList.contains('hidden') ? '' : 'rgba(0, 0, 0, 0.8)';
                controlSection.style.position = 'absolute';
                controlSection.style.zIndex = '10'; // Ensure it appears over the PDF viewer
            } else {
                switch (event.key) {
                    case 'ArrowLeft': showPrevPage(); break;
                    case 'ArrowRight': showNextPage(); break;
                    case 'ArrowUp': case 'PageUp': showPrevPage(); break;
                    case 'ArrowDown': case 'PageDown': showNextPage(); break;
                    case 'Home': pageNum = 1; queueRenderPage(pageNum); break;
                    case 'End': pageNum = pdfDoc.numPages; queueRenderPage(pageNum); break;
                    case 'Enter': case ' ': if (focusedElement !== 'input') showNextPage(); break;
                    case 'f': toggleFullScreen(); break;
                    case 'b': addBookmarkModal(); break;
                    default: break;
                }
            }
        }, 200); // Adjust the delay as needed
    }
};

const handleTouchStart = (evt) => {
    const firstTouch = evt.touches[0];
    xDown = firstTouch.clientX;
    yDown = firstTouch.clientY;
};

const handleTouchMove = (evt) => {
    if (!xDown || !yDown) return;
    const xUp = evt.touches[0].clientX, yUp = evt.touches[0].clientY;
    const xDiff = xDown - xUp, yDiff = yDown - yUp;
    if (Math.abs(xDiff) > Math.abs(yDiff)) {
        if (xDiff > 0) showNextPage(); else showPrevPage(); // Swiping right to left goes to the next page
    } else {
        if (yDiff > 0) showNextPage(); else showPrevPage();
    }
    xDown = null; yDown = null;
};

const handleWheel = (event) => { debounce(() => { if (event.deltaY > 0) showNextPage(); else showPrevPage(); }, 100); };

const handleMouseUpDown = (event) => { if (event.button === 4) showPrevPage(); else if (event.button === 5) showNextPage(); };

const handleResize = () => {
    renderPage(pageNum, scale);
    localStorage.setItem('lastPage', pageNum); // Save the current page number to localStorage
};

const handlePageInputKeyDown = (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        jumpToPage();
    }
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

const closeConfirmDeleteModal = () => {
    const modal = document.getElementById('confirm-delete-modal');
    modal.classList.add('hidden');
    modal.setAttribute('inert', '');
};

const toggleBookmarks = () => {
    const bookmarkSection = document.getElementById('bookmark-section');
    bookmarkSection.classList.toggle('hidden');
    bookmarkSection.classList.toggle('slide-in-left');
};

const requestWakeLock = async () => {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                console.log('Screen Wake Lock was released');
            });
            console.log('Screen Wake Lock is active');
        } else {
            // Fallback for browsers that do not support the Wake Lock API
            wakeLockInterval = setInterval(() => {
                window.location.href = window.location.href;
            }, 180000); // 3 minutes
        }
    } catch (err) {
        console.error(`${err.name}, ${err.message}`);
    }
};

const releaseWakeLock = () => {
    if (wakeLock !== null) {
        wakeLock.release().then(() => {
            wakeLock = null;
        });
    }
    if (wakeLockInterval !== null) {
        clearInterval(wakeLockInterval);
        wakeLockInterval = null;
    }
};

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        requestWakeLock();
    } else {
        releaseWakeLock();
    }
});

window.addEventListener('beforeunload', releaseWakeLock);

document.addEventListener('DOMContentLoaded', () => {
    const prevPageBtn = document.getElementById('prev-page-btn');
    const nextPageBtn = document.getElementById('next-page-btn');
    const goToPageBtn = document.getElementById('go-to-page');
    const addBookmarkModalBtn = document.getElementById('add-bookmark-modal');
    const addBookmarkModalTopBtn = document.getElementById('add-bookmark-modal-top');
    const saveBookmarkBtn = document.getElementById('save-bookmark');
    const cancelModalBtn = document.getElementById('cancel-modal');
    const zoomInBtn = document.getElementById('zoom-in');
    const fullscreenBtn = document.getElementById('fullscreen');
    const pageInput = document.getElementById('page-input');
    const pdfViewer = document.querySelector('.pdf-viewer');
    const showBookmarksBtn = document.getElementById('show-bookmarks');
    const showControlsBtn = document.getElementById('show-controls');
    const backButton = document.getElementById('back-button');
    const toggleBookmarksSidebarBottomBtn = document.getElementById('toggle-bookmarks-sidebar-bottom');

    const addEventListenerIfExists = (element, event, handler) => {
        if (element) element.addEventListener(event, handler);
    };

    addEventListenerIfExists(prevPageBtn, 'click', showPrevPage);
    addEventListenerIfExists(nextPageBtn, 'click', showNextPage);
    addEventListenerIfExists(goToPageBtn, 'click', () => {
        jumpToPage();
        if (pageInput) pageInput.value = '';
    });
    addEventListenerIfExists(addBookmarkModalBtn, 'click', addBookmarkModal);
    addEventListenerIfExists(addBookmarkModalTopBtn, 'click', addBookmarkModal);
    addEventListenerIfExists(saveBookmarkBtn, 'click', saveBookmark);
    addEventListenerIfExists(cancelModalBtn, 'click', closeModal);
    addEventListenerIfExists(zoomInBtn, 'click', zoomIn);
    addEventListenerIfExists(fullscreenBtn, 'click', toggleFullScreen);
    addEventListenerIfExists(pageInput, 'keydown', handlePageInputKeyDown);
    addEventListenerIfExists(pageInput, 'focus', () => setFocus('input'));
    addEventListenerIfExists(pageInput, 'blur', () => clearFocus('input'));
    addEventListenerIfExists(showBookmarksBtn, 'click', toggleBookmarks);
    addEventListenerIfExists(showControlsBtn, 'click', () => {
        document.getElementById('control-section').classList.toggle('hidden');
    });
    addEventListenerIfExists(backButton, 'click', () => {
        window.history.back();
    });
    addEventListenerIfExists(toggleBookmarksSidebarBottomBtn, 'click', toggleBookmarks);

    if (pdfViewer) {
        pdfViewer.style.zIndex = '1'; // Set z-index to a low value
        pdfViewer.addEventListener('wheel', handleWheel);
        pdfViewer.addEventListener('mousedown', handleMouseUpDown);
        pdfViewer.ondblclick = toggleFullScreen;
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('touchstart', handleTouchStart);
    document.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('resize', handleResize);
    document.addEventListener('fullscreenchange', handleResize);
    updateBookmarkList();

    // Automatically click the zoom-in button once after every reload
    if (zoomInBtn) {
        zoomInBtn.click();
    }

    requestWakeLock();
});

window.jumpToBookmark = jumpToBookmark;
window.setFocus = setFocus;
window.clearFocus = clearFocus;
window.zoomIn = zoomIn;
window.handleKeyDown = handleKeyDown;
window.editBookmark = editBookmark;
window.deleteBookmark = deleteBookmark;
window.showPrevPage = showPrevPage;
window.showNextPage = showNextPage;
window.jumpToPage = jumpToPage;
window.toggleFullScreen = toggleFullScreen;
window.addBookmarkModal = addBookmarkModal;
window.saveBookmark = saveBookmark;
window.closeModal = closeModal;
window.updateBookmarkList = updateBookmarkList;
window.confirmDeleteBookmark = confirmDeleteBookmark;
window.handleTouchStart = handleTouchStart;
window.handleTouchMove = handleTouchMove;
window.closeConfirmDeleteModal = closeConfirmDeleteModal;
window.toggleBookmarks = toggleBookmarks;
window.updateStarColor = updateStarColor;
window.handlePageInputKeyDown = handlePageInputKeyDown;
