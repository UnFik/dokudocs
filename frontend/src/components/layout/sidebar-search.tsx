import { Search } from 'lucide-react'
import { useSearch } from '@/context/search-provider'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

export function SidebarSearch() {
  const { setOpen } = useSearch()
  const { state } = useSidebar()
  const isCollapsed = state === 'collapsed'

  return (
    <SidebarMenu className='px-0'>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={() => setOpen(true)}
          tooltip='Search (⌘K)'
          className='relative h-8 w-full justify-start rounded-lg border border-sidebar-border/70 bg-sidebar-accent/40 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground'
        >
          <Search className='size-3.5 shrink-0 opacity-70' />
          {!isCollapsed && (
            <>
              <span className='truncate text-xs font-normal'>
                Search docs & diagrams...
              </span>
              <kbd className='pointer-events-none absolute top-1/2 right-2 hidden h-4.5 -translate-y-1/2 items-center gap-0.5 rounded border border-sidebar-border bg-background/80 px-1 font-mono text-[9px] font-medium text-muted-foreground/80 sm:inline-flex'>
                ⌘K
              </kbd>
            </>
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
