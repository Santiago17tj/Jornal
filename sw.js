// Jornal — cache local para que la app abra sin internet.
// Sube este número en cada publicación: al activarse borra las cachés viejas.
const CACHE = 'jornal-v9';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Nunca servir el propio service worker desde caché: si una vez falla la red,
  // quedaría congelado en esta versión y la app no volvería a actualizarse.
  if (url.origin === location.origin && url.pathname.endsWith('/sw.js')) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        // solo se guarda lo propio y lo que respondió bien
        if (r.ok && r.type === 'basic') {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return r;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
