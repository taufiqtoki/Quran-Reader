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

export { openDB, getCachedPage, cachePage };
