import { showPrevPage, showNextPage, jumpToPage, queueRenderPage } from './pdf.js';
import { addBookmarkModal } from './bookmarks.js';

let xDown = null;
let yDown = null;
let focusedElement = null;
let debounceTimeout;
let pageNum; // Declare pageNum

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

export { setFocus, clearFocus, handleKeyDown, handleTouchStart, handleTouchMove, handleWheel, handleMouseUpDown, toggleFullScreen };
