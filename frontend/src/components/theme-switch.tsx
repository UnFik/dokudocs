import { useEffect } from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/context/theme-provider'
import { cn } from '@/lib/utils'

export function ThemeSwitch() {
  const { theme, setTheme, resolvedTheme } = useTheme()

  /* Update theme-color meta tag
   * when theme is updated */
  useEffect(() => {
    const themeColor = resolvedTheme === 'dark' ? '#020817' : '#fff'
    const metaThemeColor = document.querySelector("meta[name='theme-color']")
    if (metaThemeColor) metaThemeColor.setAttribute('content', themeColor)
  }, [theme, resolvedTheme])

  const isDark = resolvedTheme === 'dark'

  return (
    <SwitchPrimitive.Root
      checked={isDark}
      onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
      className={cn(
        'peer inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full p-0.5 border border-transparent shadow-xs transition-colors outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        'bg-muted-foreground/20 data-[state=checked]:bg-primary'
      )}
      aria-label='Toggle theme'
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none flex size-5 items-center justify-center rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-6 data-[state=unchecked]:translate-x-0'
        )}
      >
        {isDark ? (
          <Moon className='size-3 text-indigo-500 fill-indigo-500/10 transition-transform duration-300 rotate-0 dark:rotate-360' />
        ) : (
          <Sun className='size-3 text-amber-500 fill-amber-500/10 transition-transform duration-300 rotate-0' />
        )}
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  )
}


