/** Emit a self-contained service worker that precaches every shipped asset. */
import { createHash } from 'node:crypto';

export default function offlinePlugin() {
  return {
    name: 'journey:offline',
    apply: 'build',

    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((name) => name !== 'sw.js' && !name.endsWith('.map'))
        .sort();
      // The scope root makes a navigation to `/repo/` work as well as an
      // explicit `/repo/index.html`; every emitted chunk is relative to it.
      const precache = ['./', ...files.map((name) => `./${name}`)];
      const digest = createHash('sha256');
      for (const name of files) {
        const item = bundle[name];
        digest.update(name);
        digest.update(item.type === 'chunk' ? item.code : item.source);
      }
      const version = digest.digest('hex').slice(0, 16);
      const source = `
const CACHE = ${JSON.stringify(`my-life-with-christ-${version}`)};
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(PRECACHE.map((path) => new URL(path, self.registration.scope).href)),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('my-life-with-christ-') && key !== CACHE)
        .map((key) => caches.delete(key))))
      // A first install begins after the current page has loaded. Claim that
      // page as soon as activation finishes, or its unvisited lazy routes still
      // bypass this complete cache until somebody manually reloads.
      //
      // Deliberately no skipWaiting(): during an update, the old controller
      // should finish serving old hashed chunks until its tabs close rather
      // than mixing an old document with the new cache.
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Static hosts commonly send Vary: Origin. The install fetch has no
    // module Origin header while a later dynamic import does, so ordinary
    // Cache.match treats the identical immutable URL as a miss. This cache is
    // same-origin and content-versioned; varying it by that request header has
    // no useful meaning.
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const shell = await cache.match(new URL('./index.html', self.registration.scope).href, { ignoreVary: true })
        ?? await cache.match(new URL('./', self.registration.scope).href, { ignoreVary: true });
      if (shell) return shell;
    }

    return fetch(request);
  })());
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
