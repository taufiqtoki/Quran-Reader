// db.js
const dbName = 'pdfCacheDB';
const storeName = 'pages';
let db;

const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);

    request.onupgradeneeded = (event) => {
      db = event.target.result;
      db.createObjectStore(storeName, { keyPath: 'page' });
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve();
    };

    request.onerror = (event) => {
      console.error('Database error:', event.target.error);
      reject(event.target.error);
    };
  });
};

const getCachedPage = (page) => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(page);

    request.onsuccess = (event) => {
      resolve(event.target.result ? event.target.result.dataUrl : null);
    };

    request.onerror = (event) => {
      console.error('Error fetching cached page:', event.target.error);
      reject(event.target.error);
    };
  });
};

const cachePage = (page, dataUrl) => {
  const transaction = db.transaction([storeName], 'readwrite');
  const store = transaction.objectStore(storeName);
  const request = store.put({ page, dataUrl });

  request.onerror = (event) => {
    console.error('Error caching page:', event.target.error);
  };
};

// bookmarks.js
let bookmarks = JSON.parse(localStorage.getItem('bookmarks')) || [];
let pageNum = localStorage.getItem('lastPage') ? parseInt(localStorage.getItem('lastPage'), 10) : 1; // Define pageNum

const updateBookmarkList = () => {
  const bookmarkList = document.getElementById('bookmark-list');
  bookmarkList.innerHTML = '';
  bookmarks.forEach((bookmark, index) => {
    const li = document.createElement('li');
    li.className = 'flex justify-between items-center bg-gray-200 px-4 py-2 rounded';
    li.innerHTML = `<span class="cursor-pointer" onclick="jumpToBookmark(${bookmark.page})">${bookmark.name} (Page ${bookmark.page})</span>
      <div class="flex space-x-2">
        <button class="text-blue-500" onclick="editBookmark(${index})">✎</button>
        <button class="text-red-500" onclick="deleteBookmark(${index})">✖</button>
      </div>`;
    bookmarkList.appendChild(li);
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
  document.getElementById('bookmark-modal').classList.remove('hidden');
};

const saveBookmark = () => {
  const page = parseInt(document.getElementById('modal-page-number').value, 10);
  const name = document.getElementById('modal-bookmark-name').value.trim();

  if (!page || !name) {
    alert('Please enter both a page number and a bookmark name.');
    return;
  }

  bookmarks.push({ page, name });
  updateBookmarkList();
  closeModal();
  updateStarColor();
};

const editBookmark = (index) => {
  const bookmark = bookmarks[index];
  document.getElementById('modal-page-number').value = bookmark.page;
  document.getElementById('modal-bookmark-name').value = bookmark.name;
  document.getElementById('bookmark-modal').classList.remove('hidden');

  const saveButton = document.getElementById('save-bookmark');
  saveButton.onclick = () => {
    bookmarks[index] = {
      page: parseInt(document.getElementById('modal-page-number').value, 10),
      name: document.getElementById('modal-bookmark-name').value.trim()
    };
    updateBookmarkList();
    closeModal();
  };

  document.getElementById('bookmark-modal').onkeydown = (event) => {
    if (event.key === 'Enter') {
      saveButton.click();
    }
  };
};

const deleteBookmark = (index) => {
  if (confirm('Are you sure you want to delete this bookmark?')) {
    bookmarks.splice(index, 1);
    updateBookmarkList();
  }
};

const closeModal = () => {
  document.getElementById('bookmark-modal').classList.add('hidden');
};

const updateStarColor = () => {
  const addBookmarkButton = document.getElementById('add-bookmark-modal');
  const isBookmarked = bookmarks.some(bookmark => bookmark.page === pageNum);
  addBookmarkButton.style.color = isBookmarked ? 'blue' : 'black';
};

// pdf.js
let pdfDoc = null;
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

export { openDB, getCachedPage, cachePage, setPdfDoc, renderPage, queueRenderPage, showPrevPage, showNextPage, jumpToPage, zoomIn, zoomOut, resetZoom, bufferNextPages, updateBookmarkList, jumpToBookmark, addBookmarkModal, saveBookmark, editBookmark, deleteBookmark, closeModal, updateStarColor };
