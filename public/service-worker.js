const CACHE_VERSION = 'v3-20251216';
const STATIC_CACHE = `padel-hub-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `padel-hub-dynamic-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          console.log('[SW] Deleting old cache during install:', key);
          return caches.delete(key);
        })
      ).then(() => {
        return caches.open(STATIC_CACHE).then((cache) => {
          console.log('[SW] Precaching static assets');
          return cache.addAll(STATIC_ASSETS);
        });
      })
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          console.log('[SW] Deleting all caches:', key);
          return caches.delete(key);
        })
      );
    }).then(() => {
      console.log('[SW] All caches cleared');
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    return;
  }

  if (url.origin === location.origin) {
    if (request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname.includes('/assets/')) {
      event.respondWith(
        fetch(request)
          .then((fetchResponse) => {
            return fetchResponse;
          })
          .catch(() => {
            return caches.match(request).then((response) => {
              return response || caches.match('/index.html');
            });
          })
      );
    } else {
      event.respondWith(
        fetch(request)
          .catch(() => {
            return caches.match(request);
          })
      );
    }
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');

  let data = {
    title: 'Nova Inscricao',
    body: 'Tem uma nova inscricao no seu torneio!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'registration',
  };

  try {
    if (event.data) {
      const payload = event.data.json();
      data = {
        ...data,
        ...payload,
      };
    }
  } catch (e) {
    console.log('[SW] Error parsing push data:', e);
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    tag: data.tag || 'notification',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/',
      tournamentId: data.tournamentId,
    },
    actions: [
      { action: 'open', title: 'Ver' },
      { action: 'close', title: 'Fechar' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked');
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus().then((focusedClient) => {
            if (focusedClient && urlToOpen !== '/') {
              focusedClient.postMessage({
                type: 'NAVIGATE',
                url: urlToOpen,
              });
            }
            return focusedClient;
          });
        }
      }
      return clients.openWindow(urlToOpen);
    })
  );
});
