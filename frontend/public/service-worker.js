const CACHE_NAME = '__DOKUDOCS_CACHE_NAME__'
const PRECACHE_ASSETS = __DOKUDOCS_PRECACHE_ASSETS__

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(['/', ...PRECACHE_ASSETS]))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('dokudocs-shell-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

// Vite preview adds Vary: Origin, though same-origin shell and asset bytes do not vary by Origin.
self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname === '/api' ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/auth/callback' ||
    request.headers.has('authorization')
  )
    return

  if (request.mode === 'navigate') {
    const network = fetch(request)
    event.waitUntil(
      network
        .then((response) => {
          if (
            response.ok &&
            response.headers.get('content-type')?.includes('text/html')
          )
            return caches.open(CACHE_NAME).then((cache) =>
              cache.put('/', response.clone())
            )
        })
        .catch(() => undefined)
    )
    event.respondWith(
      network.catch(
        async () =>
          (await caches.match('/', { ignoreVary: true })) ?? Response.error()
      )
    )
    return
  }

  if (
    !['script', 'style', 'worker', 'font', 'image'].includes(request.destination) &&
    !/\.(js|css)$/.test(url.pathname)
  )
    return

  const network = fetch(request)
  event.waitUntil(
    network
      .then((response) => {
        if (response.ok && response.type === 'basic')
          return caches.open(CACHE_NAME).then((cache) =>
            cache.put(request, response.clone())
          )
      })
      .catch(() => undefined)
  )
  event.respondWith(
    network.catch(
      async () =>
        (await caches.match(request, { ignoreVary: true })) ?? Response.error()
    )
  )
})
