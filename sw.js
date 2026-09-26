const CACHE='bap-gastos-v6';
const ASSETS=['./','./index.html','./styles.css','./app.js','./xlsx.js','./privacy.html','./manifest.webmanifest','./icon.svg','./config.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith((async()=>{const cache=await caches.open(CACHE);try{const response=await fetch(event.request);if(response.ok)cache.put(event.request,response.clone());return response}catch{return await cache.match(event.request)||Response.error()}})())});
