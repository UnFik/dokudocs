import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { startAuthSync, useAuthStore } from '@/stores/auth-store'
import { useCommentStore } from '@/stores/comment-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { onEmailNotVerified } from '@/lib/api-client'
import { queryClient } from '@/lib/query-client'
import { DirectionProvider } from './context/direction-provider'
import { FontProvider } from './context/font-provider'
import { ThemeProvider } from './context/theme-provider'
// Generated Routes
import { routeTree } from './routeTree.gen'
// Styles
import './styles/index.css'

if (typeof window !== 'undefined') {
  ;(window as unknown as { useCommentStore: unknown }).useCommentStore =
    useCommentStore
  ;(window as unknown as { useDokudocsStore: unknown }).useDokudocsStore =
    useDokudocsStore
}

// Create a new router instance
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadDelay: 0,
  defaultPreloadStaleTime: 1000 * 60 * 5,
  defaultPreloadGcTime: 1000 * 60 * 15,
})

useAuthStore.subscribe((state, previous) => {
  if (state.auth.revision !== previous.auth.revision) {
    void queryClient.cancelQueries()
    queryClient.clear()
    void router.invalidate()
  }
})
onEmailNotVerified(() => {
  if (router.state.location.pathname !== '/verify-email')
    void router.navigate({ to: '/verify-email' })
})
startAuthSync()
window.addEventListener('online', () => void router.invalidate())

if (import.meta.env.PROD && 'serviceWorker' in navigator)
  void navigator.serviceWorker.register('/service-worker.js', { scope: '/' })

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Render the app
const rootElement = document.getElementById('root')!
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <FontProvider>
            <DirectionProvider>
              <RouterProvider router={router} />
            </DirectionProvider>
          </FontProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  )
}
