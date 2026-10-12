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
  // Give it back to where the user was, unless a follow-up dialog took it.
  const returnFocusTo = useRef<Element | null>(null)
  useEffect(() => {
    if (open) {
      returnFocusTo.current = document.activeElement
      return
    }
    const target = returnFocusTo.current
    returnFocusTo.current = null
    if (!(target instanceof HTMLElement) || !target.isConnected) return
    const timer = setTimeout(() => {
      if (document.activeElement === document.body) target.focus()
    })
    return () => clearTimeout(timer)
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
