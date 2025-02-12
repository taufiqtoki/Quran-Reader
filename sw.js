const CACHE_NAME = 'quran-reader-v1';
const PDF_CACHE_NAME = 'pdf-cache-v1';
const FIREBASE_DOMAINS = [
  'firestore.googleapis.com',
  'apis.google.com',
  'www.googleapis.com'
];

// Add valid schemes
const VALID_SCHEMES = ['http:', 'https:'];

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/main.js',
  '/auth.js',
  '/pdfManager.js',
  '/assets/star.svg',
  '/assets/three-dash.svg',
  '/assets/quran-icon.png',
  '/assets/lib/tailwind.min.css',  // Add Tailwind CSS to cache
  // ...existing cache items...
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Special handling for PDF files
  if (url.pathname.endsWith('.pdf')) {
    event.respondWith(
      caches.match(event.request)
        .then(async (response) => {
          if (response) return response;

          try {
            const networkResponse = await fetch(event.request, {
              mode: 'cors',
              credentials: 'omit',
              headers: {
                'Range': 'bytes=0-'
              }
            });
            
            if (!networkResponse || networkResponse.status !== 200) {
              throw new Error('PDF fetch failed');
            }

            const cache = await caches.open(PDF_CACHE_NAME);
            await cache.put(event.request, networkResponse.clone());
            return networkResponse;
          } catch (error) {
            console.error('PDF fetch error:', error);
            return new Response('PDF fetch failed', { status: 503 });
          }
        })
    );
    return;
  }

  // Only cache requests with valid schemes and non-Firebase domains
  if (!VALID_SCHEMES.includes(url.protocol) || 
      FIREBASE_DOMAINS.some(domain => url.hostname.includes(domain))) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(async (response) => {
      if (response) return response;

      try {
        const fetchResponse = await fetch(event.request.clone());
        
        if (!fetchResponse || fetchResponse.status !== 200) {
          return fetchResponse;
        }

        // Only cache GET requests with valid schemes
        if (event.request.method === 'GET' && 
            VALID_SCHEMES.includes(url.protocol)) {
          try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(event.request, fetchResponse.clone());
          } catch (err) {
            console.warn('Cache put error:', err.message);
          }
        }

        return fetchResponse;
      } catch (error) {
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response(null, { status: 200 });
      }
    })
  );
});

// Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME && name !== PDF_CACHE_NAME)
          .map(name => caches.delete(name))
      );
    })
  );
});
