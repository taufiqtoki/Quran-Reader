const CACHE_NAME = 'quran-reader-v1';
const PDF_CACHE_NAME = 'pdf-cache-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll([
          './',
          './index.html',
          './style.css',
          './main.js',
          './auth.js',
          './pdfManager.js',
          './assets/star.svg',
          './assets/three-dash.svg',
          './assets/quran-icon.png'
        ]);
      }),
      caches.open(PDF_CACHE_NAME).then((cache) => {
        return cache.add('./assets/book.pdf')
          .catch(error => console.log('PDF caching failed:', error));
      })
    ])
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }

      // For PDF requests, try network first then cache
      if (event.request.url.endsWith('.pdf')) {
        return fetch(event.request)
          .then(response => {
            const responseClone = response.clone();
            caches.open(PDF_CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
            return response;
          })
          .catch(() => {
            return caches.match(event.request);
          });
      }

      // Clone the request because it can only be used once
      const fetchRequest = event.request.clone();

      return fetch(fetchRequest)
        .then((response) => {
          // Check if we received a valid response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Clone the response because it can only be used once
          const responseToCache = response.clone();

          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            });

          return response;
        })
        .catch(() => {
          // Return a fallback response if offline
          if (event.request.url.includes('firestore.googleapis.com')) {
            return new Response(JSON.stringify({ offline: true }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
        });
    })
  );
});
