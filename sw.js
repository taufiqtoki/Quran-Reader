const CACHE_NAME = 'quran-reader-v1';
const PDF_CACHE_NAME = 'pdf-cache-v1';
const FIREBASE_DOMAINS = [
  'firestore.googleapis.com',
  'apis.google.com',
  'www.googleapis.com'
];

// Add valid schemes
const VALID_SCHEMES = ['http:', 'https:'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/style.css',
        '/main.js',
        '/auth.js',
        '/pdfManager.js',
        '/assets/star.svg',
        '/assets/three-dash.svg',
        '/assets/quran-icon.png'
      ]);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
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
