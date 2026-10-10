// Shows a push from Firebase Cloud Messaging. It is registered by lib/push.ts in
// its own scope, so it never takes over the page the way service-worker.js does.
// The server sends data only: title, body and url; this decides what to show.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = (event.data && event.data.json().data) || {}
  } catch {
    // A push with no readable data still gets a generic notification below.
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      // Open pages refresh their own list; one in front needs no pop-up on top of it.
      for (const client of windows) client.postMessage({ type: 'dokudocs-push' })
      if (windows.some((client) => client.focused)) return
      await self.registration.showNotification(data.title || 'Dokudocs', {
        body: data.body || '',
        data: { url: data.url || '/' },
        // One notification per comment: an edit replaces it.
        tag: data.url || undefined,
      })
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(
    (event.notification.data && event.notification.data.url) || '/',
    self.location.origin
  )
  // Never follow a link that leaves this site.
  if (target.origin !== self.location.origin) return
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const open = windows.find((client) => 'navigate' in client)
      if (open) {
        await open.navigate(target.href)
        await open.focus()
        return
      }
      await self.clients.openWindow(target.href)
    })()
  )
})
