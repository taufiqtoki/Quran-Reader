import { openDB } from './db.js';
import { setPdfDoc, renderPage, queueRenderPage, showPrevPage, showNextPage, jumpToPage, zoomIn, zoomOut, resetZoom } from './pdf.js';
import { updateBookmarkList, addBookmarkModal, saveBookmark, closeModal, jumpToBookmark } from './bookmarks.js'; // Import jumpToBookmark
import { setFocus, clearFocus, handleKeyDown, handleTouchStart, handleTouchMove, handleWheel, handleMouseUpDown, toggleFullScreen } from './events.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

const url = './assets/book.pdf'; // Define the URL for the PDF file
let pdfDoc = null;
let pageNum = localStorage.getItem('lastPage') ? parseInt(localStorage.getItem('lastPage'), 10) : 1;

openDB().then(() => {
  pdfjsLib.getDocument(url).promise.then((pdfDoc_) => {
    pdfDoc = pdfDoc_;
    setPdfDoc(pdfDoc); // Set the pdfDoc in the pdf.js module
    renderPage(pageNum);
  }).catch((err) => {
    console.error('Error loading PDF:', err);
    alert('Failed to load PDF. Please check the file path.');
  });
}).catch((err) => {
  console.error('Failed to open IndexedDB:', err);
});

// Event listeners
document.getElementById('prev-page').addEventListener('click', showPrevPage);
document.getElementById('next-page').addEventListener('click', showNextPage);
document.getElementById('go-to-page').addEventListener('click', jumpToPage);
document.getElementById('add-bookmark-modal').addEventListener('click', addBookmarkModal);
document.getElementById('save-bookmark').addEventListener('click', saveBookmark);
document.getElementById('cancel-modal').addEventListener('click', closeModal);
document.getElementById('zoom-in').addEventListener('click', zoomIn);
document.getElementById('zoom-out').addEventListener('click', zoomOut);
document.getElementById('reset-zoom').addEventListener('click', resetZoom);

document.getElementById('page-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    jumpToPage();
  }
});

document.querySelector('.pdf-viewer').addEventListener('wheel', handleWheel);
document.querySelector('.pdf-viewer').addEventListener('mousedown', handleMouseUpDown);

document.addEventListener('keydown', (event) => handleKeyDown(event, pdfDoc));
document.addEventListener('touchstart', handleTouchStart);
document.addEventListener('touchmove', handleTouchMove);

updateBookmarkList();

// Expose jumpToBookmark, setFocus, clearFocus, zoomIn, zoomOut, resetZoom, and handleKeyDown to the global scope
window.jumpToBookmark = jumpToBookmark;
window.setFocus = setFocus;
window.clearFocus = clearFocus;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.resetZoom = resetZoom;
window.handleKeyDown = (event) => handleKeyDown(event, pdfDoc);
