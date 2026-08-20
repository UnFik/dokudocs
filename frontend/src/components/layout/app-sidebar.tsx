import { Fragment } from 'react'
import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import { SidebarSearch } from './sidebar-search'
import { StarredNavGroup } from './starred-nav-group'

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader className='gap-2 pb-2'>
        <NavUser user={sidebarData.user} />
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
      <SidebarRail />
    </Sidebar>
  )
}
