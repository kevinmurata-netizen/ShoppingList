// Cache the app shell. Private list snapshots and queued changes live in IndexedDB; API responses are never cached.
const CACHE = "family-cart-shell-v3";
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(["/", "/icon.svg", "/manifest.webmanifest"]);
      const html = await (await cache.match("/")).text();
      const assets = [
        ...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g),
      ].map((match) => match[1]);
      await cache.addAll(assets);
    })(),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "OFFLINE_READY")
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE);
        const root = await cache.match("/");
        const html = root ? await root.text() : "";
        const assets = [
          ...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g),
        ].map((match) => match[1]);
        const ready =
          assets.length > 0 &&
          (await Promise.all(assets.map((path) => cache.match(path)))).every(
            Boolean,
          );
        event.ports[0]?.postMessage({ version: CACHE, ready });
      })(),
    );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/live/")
  )
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          if (
            response.ok &&
            response.headers.get("Content-Type")?.includes("text/html")
          ) {
            const html = await response.clone().text();
            // A free host can return a temporary wake-up page. Keep the real
            // app shell rather than replacing it with the host's placeholder.
            if (html.includes('id="root"') && /src="\/assets\//.test(html))
              await (await caches.open(CACHE)).put("/", response.clone());
            else {
              const saved = await caches.match("/");
              if (saved) return saved;
            }
          } else if (response.status >= 500) {
            const saved = await caches.match("/");
            if (saved) return saved;
          }
          return response;
        })
        .catch(() => caches.match("/")),
    );
  } else if (
    url.pathname.startsWith("/assets/") ||
    /\.(png|svg|webmanifest)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then(async (response) => {
            if (response.ok) {
              const copy = response.clone();
              await (await caches.open(CACHE)).put(event.request, copy);
            }
            return response;
          }),
      ),
    );
  }
});
