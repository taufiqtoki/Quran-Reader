import { getCachedPage, cachePage } from './db.js';
import { updateStarColor } from './bookmarks.js'; // Import updateStarColor from bookmarks.js

let pdfDoc = null;
let pageNum = localStorage.getItem('lastPage') ? parseInt(localStorage.getItem('lastPage'), 10) : 1;
let pageIsRendering = false;
let pageNumPending = null;
let scale = 1;
const canvas = document.getElementById('pdf-render');
const ctx = canvas.getContext('2d');
let renderTask = null; // Track the current render task

const setPdfDoc = (doc) => {
  pdfDoc = doc;
};

const renderPage = (num) => {
  if (!pdfDoc) {
    console.error('PDF document is not loaded.');
    return;
  }

  if (renderTask) {
    renderTask.cancel(); // Cancel the previous render task if it exists
  }

  getCachedPage(num).then((dataUrl) => {
    if (dataUrl) {
      renderFromCache(dataUrl, num);
      return;
    }

    pageIsRendering = true;
    document.getElementById('loading').style.display = 'flex';
    pdfDoc.getPage(num).then((page) => {
      const viewport = page.getViewport({ scale });
      const outputScale = window.devicePixelRatio || 1;

      // Adjust canvas size for high-resolution displays
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const renderCtx = {
        canvasContext: ctx,
        viewport,
        transform: [outputScale, 0, 0, outputScale, 0, 0]
      };

      renderTask = page.render(renderCtx);
      renderTask.promise.then(() => {
        pageIsRendering = false;
        document.getElementById('loading').style.display = 'none';
        if (pageNumPending !== null) {
          renderPage(pageNumPending);
          pageNumPending = null;
        }
        cachePage(num, canvas.toDataURL());
        console.log(`Page ${num} loaded and cached.`);
      }).catch((err) => {
        console.error('Error rendering page:', err);
        alert('Failed to render page.');
      });
      document.getElementById('page-info').textContent = `Page ${num} of ${pdfDoc.numPages}`;
      localStorage.setItem('lastPage', num);
      updateStarColor();
      bufferNextPages(num);
    }).catch((err) => {
      console.error('Error getting page:', err);
      alert('Failed to get page.');
    });
  }).catch((err) => {
    console.error('Error getting cached page:', err);
  });
};

const renderFromCache = (dataUrl, num) => {
  const img = new Image();
  img.src = dataUrl;
  img.onload = () => {
    // Clear the canvas before drawing the cached image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    document.getElementById('page-info').textContent = `Page ${num} of ${pdfDoc.numPages}`;
    localStorage.setItem('lastPage', num);
    updateStarColor();
    bufferNextPages(num);
    document.getElementById('loading').style.display = 'none';
  };
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
    document.getElementById('loading').style.display = 'flex';
    pageNum = page;
    queueRenderPage(pageNum);
  } else {
    alert('Invalid page number.');
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

const bufferNextPages = (currentPage) => {
  const startPage = currentPage + 1;
  const endPage = Math.min(currentPage + 5, pdfDoc.numPages);
  for (let i = startPage; i <= endPage; i++) {
    getCachedPage(i).then((dataUrl) => {
      if (!dataUrl) {
        pdfDoc.getPage(i).then((page) => {
          const viewport = page.getViewport({ scale });
          const outputScale = window.devicePixelRatio || 1;
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          // Adjust canvas size for high-resolution displays
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;

          const renderCtx = {
            canvasContext: ctx,
            viewport,
            transform: [outputScale, 0, 0, outputScale, 0, 0]
          };

          page.render(renderCtx).promise.then(() => {
            cachePage(i, canvas.toDataURL());
            console.log(`Buffered page ${i}.`);
          }).catch((err) => {
            console.error('Error buffering page:', err);
          });
        }).catch((err) => {
          console.error('Error getting page for buffering:', err);
        });
      }
    }).catch((err) => {
      console.error('Error getting cached page for buffering:', err);
    });
  }
};

export { setPdfDoc, renderPage, queueRenderPage, showPrevPage, showNextPage, jumpToPage, zoomIn, zoomOut, resetZoom, bufferNextPages };
