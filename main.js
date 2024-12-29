import { openDB, setPdfDoc, renderPage, queueRenderPage, showPrevPage, showNextPage, jumpToPage, zoomIn, zoomOut, resetZoom, updateBookmarkList, addBookmarkModal, saveBookmark, closeModal, jumpToBookmark, toggleFullScreen } from './pdfManager.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

const url = './assets/book.pdf';
let pdfDoc = null;
let pageNum = localStorage.getItem('lastPage') ? parseInt(localStorage.getItem('lastPage'), 10) : 1;

openDB().then(() => {
    pdfjsLib.getDocument(url).promise.then((pdfDoc_) => {
        pdfDoc = pdfDoc_;
        setPdfDoc(pdfDoc);
        renderPage(pageNum);
    });
});

let xDown = null, yDown = null, focusedElement = null, debounceTimeout;

const setFocus = (element) => { focusedElement = element; };
const clearFocus = (element) => { if (focusedElement === element) focusedElement = null; };

const handleKeyDown = (event, pdfDoc) => {
    if (focusedElement !== 'input') {
        switch (event.key) {
            case 'ArrowLeft': showPrevPage(); break;
            case 'ArrowRight': showNextPage(); break;
            case 'ArrowUp': case 'PageUp': showPrevPage(); break;
            case 'ArrowDown': case 'PageDown': showNextPage(); break;
            case 'Home': pageNum = 1; queueRenderPage(pageNum); break;
            case 'End': pageNum = pdfDoc.numPages; queueRenderPage(pageNum); break;
            case 'Enter': case ' ': showNextPage(); break;
            case 'f': toggleFullScreen(); break;
            case 'b': addBookmarkModal(); break;
            default: break;
        }
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
        if (xDiff > 0) showNextPage(); else showPrevPage();
    }
    xDown = null; yDown = null;
};

const debounce = (func, delay) => { clearTimeout(debounceTimeout); debounceTimeout = setTimeout(func, delay); };

const handleWheel = (event) => { debounce(() => { if (event.deltaY > 0) showNextPage(); else showPrevPage(); }, 100); };

const handleMouseUpDown = (event) => { if (event.button === 4) showPrevPage(); else if (event.button === 5) showNextPage(); };

const handleResize = () => {
    renderPage(pageNum);
};

document.addEventListener('DOMContentLoaded', () => {
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const goToPageBtn = document.getElementById('go-to-page');
    const addBookmarkModalBtn = document.getElementById('add-bookmark-modal');
    const saveBookmarkBtn = document.getElementById('save-bookmark');
    const cancelModalBtn = document.getElementById('cancel-modal');
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const resetZoomBtn = document.getElementById('reset-zoom');
    const fullscreenBtn = document.getElementById('fullscreen');
    const pageInput = document.getElementById('page-input');
    const pdfViewer = document.querySelector('.pdf-viewer');

    if (prevPageBtn) prevPageBtn.addEventListener('click', showPrevPage);
    if (nextPageBtn) nextPageBtn.addEventListener('click', showNextPage);
    if (goToPageBtn) goToPageBtn.addEventListener('click', jumpToPage);
    if (addBookmarkModalBtn) addBookmarkModalBtn.addEventListener('click', addBookmarkModal);
    if (saveBookmarkBtn) saveBookmarkBtn.addEventListener('click', saveBookmark);
    if (cancelModalBtn) cancelModalBtn.addEventListener('click', closeModal);
    if (zoomInBtn) zoomInBtn.addEventListener('click', zoomIn);
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', zoomOut);
    if (resetZoomBtn) resetZoomBtn.addEventListener('click', resetZoom);
    if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullScreen);
    if (pageInput) pageInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') jumpToPage(); });
    if (pdfViewer) {
        pdfViewer.addEventListener('wheel', handleWheel);
        pdfViewer.addEventListener('mousedown', handleMouseUpDown);
        pdfViewer.ondblclick = toggleFullScreen;
    }
    document.addEventListener('keydown', (event) => handleKeyDown(event, pdfDoc));
    document.addEventListener('touchstart', handleTouchStart);
    document.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('resize', handleResize);
    document.addEventListener('fullscreenchange', handleResize);
    updateBookmarkList();
});

window.jumpToBookmark = jumpToBookmark;
window.setFocus = setFocus;
window.clearFocus = clearFocus;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.resetZoom = resetZoom;
window.handleKeyDown = (event) => handleKeyDown(event, pdfDoc);
