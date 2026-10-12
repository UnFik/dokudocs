import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/context/theme-provider'
import { Button } from '@/components/ui/button'

/** A one-tap light/dark switch for places where the theme settings are out of reach. */
export function ThemeToggleButton({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  return (
    <Button
      type='button'
      variant='outline'
      size='icon'
      className={className}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      title={dark ? 'Switch to Light theme' : 'Switch to Dark theme'}
      aria-label='Toggle theme'
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  )
}
