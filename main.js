import { openDB, setPdfDoc, renderPage, queueRenderPage, showPrevPage, showNextPage, jumpToPage, zoomIn, zoomOut, resetZoom, updateBookmarkList, addBookmarkModal, saveBookmark, closeModal, jumpToBookmark } from './pdfManager.js';

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

// events.js
let xDown = null;
let yDown = null;
let focusedElement = null;
let debounceTimeout;

const setFocus = (element) => {
  focusedElement = element;
};

const clearFocus = (element) => {
  if (focusedElement === element) {
    focusedElement = null;
  }
};

const handleKeyDown = (event, pdfDoc) => {
  if (focusedElement !== 'input') {
    try {
      switch (event.key) {
        case 'ArrowLeft':
          showPrevPage();
          break;
        case 'ArrowRight':
          showNextPage();
          break;
        case 'ArrowUp':
        case 'PageUp':
          showPrevPage();
          break;
        case 'ArrowDown':
        case 'PageDown':
          showNextPage();
          break;
        case 'Home':
          pageNum = 1;
          queueRenderPage(pageNum);
          break;
        case 'End':
          pageNum = pdfDoc.numPages;
          queueRenderPage(pageNum);
          break;
        case 'Enter':
        case ' ':
          showNextPage();
          break;
        case 'f':
          toggleFullScreen();
          break;
        case 'b':
          addBookmarkModal();
          break;
        default:
          break;
      }
    } catch (error) {
      console.error('Error handling key down event:', error);
    }
  }
};

const handleTouchStart = (evt) => {
  const firstTouch = evt.touches[0];
  xDown = firstTouch.clientX;
  yDown = firstTouch.clientY;
};

const handleTouchMove = (evt) => {
  if (!xDown || !yDown) {
    return;
  }

  const xUp = evt.touches[0].clientX;
  const yUp = evt.touches[0].clientY;

  const xDiff = xDown - xUp;
  const yDiff = yDown - yUp;

  if (Math.abs(xDiff) > Math.abs(yDiff)) {
    if (xDiff > 0) {
      showNextPage();
    } else {
      showPrevPage();
    }
  }

  xDown = null;
  yDown = null;
};

const debounce = (func, delay) => {
  clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(func, delay);
};

const handleWheel = (event) => {
  debounce(() => {
    try {
      if (event.deltaY > 0) {
        showNextPage();
      } else {
        showPrevPage();
      }
    } catch (error) {
      console.error('Error handling wheel event:', error);
    }
  }, 100);
};

const handleMouseUpDown = (event) => {
  try {
    if (event.button === 4) { // Mouse button 4 (up)
      showPrevPage();
    } else if (event.button === 5) { // Mouse button 5 (down)
      showNextPage();
    }
  } catch (error) {
    console.error('Error handling mouse up/down event:', error);
  }
};

const toggleFullScreen = () => {
  try {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
    setTimeout(() => renderPage(pageNum), 100); // Re-render the page to adjust the canvas size after entering/exiting full-screen mode
  } catch (error) {
    console.error('Error toggling full screen mode:', error);
  }
};
