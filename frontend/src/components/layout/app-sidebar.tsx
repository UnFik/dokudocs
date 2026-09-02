import { Fragment } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import { NavWorkspace } from './nav-workspace'
import { SidebarSearch } from './sidebar-search'
import { StarredNavGroup } from './starred-nav-group'

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const { auth } = useAuthStore()

  const currentUser = auth.user
    ? {
        name: auth.user.accountNo || 'User',
        email: auth.user.email || '',
        avatar: sidebarData.user.avatar,
      }
    : sidebarData.user

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader className='gap-2 pb-2'>
        <NavWorkspace />
        <SidebarSearch />
      </SidebarHeader>
      <SidebarSeparator className='mx-0' />
      <SidebarContent className='gap-0 py-1'>
        {sidebarData.navGroups.map((props, index) => (
          <Fragment key={props.title || index}>
            {index > 0 && <SidebarSeparator className='mx-2 my-1' />}
            <NavGroup {...props} />
          </Fragment>
        ))}
        <SidebarSeparator className='mx-2 my-1' />
        <StarredNavGroup />
      </SidebarContent>
      <SidebarFooter className='p-2'>
        <NavUser user={currentUser} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
