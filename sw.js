// Shell files are served cache-first: bump this on every shell change, or installed phones keep the old app.
const CACHE = 'mkc-shell-v18';
const SHELL = [
  './', './index.html', './styles.css', './motion.css', './app.js', './api.js', './catalog.js', './motion.js', './previews.js', './billboard.js', './rows.js', './bob.js', './modal.js', './feed.js', './ambient.js', './reel.js', './settings.js', './invite.js', './player.js', './viewport.js', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png', './favicon.png',
  './fonts/cormorant-garamond-latin-400-normal.woff2', './fonts/cormorant-garamond-latin-500-normal.woff2',
  './fonts/dm-sans-latin-400-normal.woff2', './fonts/dm-sans-latin-600-normal.woff2',
  './fonts/noto-sans-arabic-arabic-400-normal.woff2', './fonts/noto-sans-arabic-arabic-600-normal.woff2'
];
const urls = new Set(SHELL.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  // 'reload' skips the browser's HTTP cache (GitHub Pages sends max-age=600), so a new version never stores old files.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(path => new Request(path, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('mkc-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('Authorization')) return;
  const root = new URL('./', self.registration.scope);
  const isAppNavigation = request.mode === 'navigate' && (url.pathname === root.pathname || url.pathname === `${root.pathname}index.html`);
  // Only the fixed public shell is cached. API data, posters and films never enter this cache.
  if (isAppNavigation) {
    event.respondWith(fetch(request).catch(() => caches.match(new URL('./index.html', self.registration.scope))));
  } else if (urls.has(url.href)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(request)) || fetch(request)));
  }
});
