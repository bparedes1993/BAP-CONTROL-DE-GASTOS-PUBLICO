const CACHE = "bap-google-activo-v12";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./finance.js",
  "./finance-model.js",
  "./finance.css",
  "./xlsx.js",
  "./privacy.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./config.js",
  "./commercial.js",
  "./commercial.css",
  "./supabase-client.js",
  "./print-report.js",
  "./sync-client.js",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    ["code", "error", "error_code", "error_description", "flow_id"].some(key => url.searchParams.has(key))
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      } catch {
        return (await cache.match(event.request)) || Response.error();
      }
    })(),
  );
});

