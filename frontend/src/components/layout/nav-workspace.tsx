import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Check, ChevronsUpDown, Plus, Settings } from 'lucide-react'
import { defaultOrganizations, useDokudocsStore } from '@/stores/dokudocs-store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { CreateWorkspaceDialog } from './create-workspace-dialog'

export function NavWorkspace() {
  const navigate = useNavigate()
  const { isMobile, state } = useSidebar()
  const [createOpen, setCreateOpen] = useState(false)
  const storeOrganizations = useDokudocsStore((s) => s.organizations)
  const activeOrgId = useDokudocsStore((s) => s.activeOrgId)
  const setActiveOrgId = useDokudocsStore((s) => s.setActiveOrgId)

  const organizations = storeOrganizations?.length
    ? storeOrganizations
    : defaultOrganizations
  const activeOrg =
    organizations.find((org) => org.id === activeOrgId) || organizations[0]

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size='lg'
                className='cursor-pointer data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
              >
                <div className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground shadow-xs'>
                  {activeOrg.name
                    ? activeOrg.name.slice(0, 2).toUpperCase()
                    : 'DK'}
                </div>
                <div className='grid flex-1 text-start text-sm leading-tight'>
                  <span className='truncate text-xs font-semibold'>
                    {activeOrg.name}
                  </span>
                  <span className='truncate text-[10px] text-muted-foreground'>
                    {activeOrg.plan || 'Free'}
                  </span>
                </div>
                <ChevronsUpDown className='ms-auto size-4 text-muted-foreground' />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg'
              side={state === 'collapsed' && !isMobile ? 'right' : 'bottom'}
              align='start'
              sideOffset={4}
            >
              <DropdownMenuLabel className='px-2 py-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'>
                Workspaces
              </DropdownMenuLabel>
              <DropdownMenuGroup>
                {organizations.map((org) => {
                  const isActive = org.id === activeOrg.id
                  return (
                    <DropdownMenuItem
                      key={org.id}
                      onClick={() => setActiveOrgId(org.id)}
                      className='flex cursor-pointer items-center gap-2.5 px-2 py-2'
                    >
                      <div className='flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-foreground'>
                        {org.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className='flex min-w-0 flex-1 flex-col'>
                        <span className='truncate text-xs font-medium'>
                          {org.name}
                        </span>
                        <span className='truncate text-[10px] text-muted-foreground'>
                          {org.plan || 'Free'}
                        </span>
                      </div>
                      {isActive && (
                        <Check className='size-3.5 shrink-0 text-primary' />
                      )}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => navigate({ to: '/settings' })}
                className='flex cursor-pointer items-center gap-2.5 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground'
              >
                <Settings className='size-4' />
                <span>Workspace Settings</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setCreateOpen(true)}
                className='flex cursor-pointer items-center gap-2.5 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground'
              >
                <div className='flex size-4 items-center justify-center rounded border border-dashed border-border text-muted-foreground'>
                  <Plus className='size-3' />
                </div>
                <span>Create Workspace</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
