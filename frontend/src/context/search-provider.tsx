import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { CommandMenu } from '@/components/command-menu'

type SearchContextType = {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
}

const SearchContext = createContext<SearchContextType | null>(null)

type SearchProviderProps = {
  children: React.ReactNode
}

export function SearchProvider({ children }: SearchProviderProps) {
  const [open, setOpen] = useState(false)
  const signedIn = useAuthStore(
    (state) => state.auth.status === 'authenticated'
  )

  useEffect(() => {
    if (!signedIn) return
    const down = (e: KeyboardEvent) => {
      // An editor that took Ctrl+K for a link has already prevented it.
      if (e.defaultPrevented) return
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [signedIn])

  // The dialog has no trigger, so Radix leaves focus on <body> when it closes.
  // While the menu is closed, remember the last focused element: reading it at
  // open time is too late, because the dialog has already taken focus. On close,
  // the dialog fades out and stays mounted (with focus inside it) until the
  // animation ends, so wait for focus to reach <body>. If something else took
  // it, such as a follow-up dialog, leave it alone.
  const returnFocusTo = useRef<Element | null>(null)
  useEffect(() => {
    if (open) return
    const target = returnFocusTo.current
    let frame = 0
    if (
      target instanceof HTMLElement &&
      target !== document.body &&
      target.isConnected
    ) {
      let waited = 0
      const restore = () => {
        const active = document.activeElement
        if (!active || active === document.body) {
          target.focus()
        } else if (active.closest('[role="dialog"]') && waited++ < 60) {
          frame = requestAnimationFrame(restore)
        }
      }
      frame = requestAnimationFrame(restore)
    }
    returnFocusTo.current = document.activeElement
    const track = (event: FocusEvent) => {
      if (event.target instanceof Element) returnFocusTo.current = event.target
    }
    document.addEventListener('focusin', track)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('focusin', track)
    }
  }, [open])

  return (
    <SearchContext value={{ open, setOpen }}>
      {children}
      <CommandMenu />
    </SearchContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useSearch = () => {
  const searchContext = useContext(SearchContext)

  if (!searchContext) {
    throw new Error('useSearch has to be used within SearchProvider')
  }

  return searchContext
}
