// Offline support: the app shell is cached on install (and refreshed in the background);
// audio clips are cached the first time they play (or all at once from Me → Download audio).
const SHELL = "dimelo-shell-v1", AUDIO = "dimelo-audio";
const FILES = ["./", "index.html", "styles.css", "manifest.webmanifest", "icons/icon.svg", "audio/manifest.json",
  ...["app", "audio", "content", "lesson", "dialogue", "clips", "partner", "progress", "srs", "match", "store", "ui", "research", "appsync"].map(f => `js/${f}.js`)];

self.addEventListener("install", e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("dimelo-shell") && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.endsWith(".mp3")) {
    e.respondWith(caches.open(AUDIO).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  // stale-while-revalidate for the shell
  e.respondWith(caches.open(SHELL).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
