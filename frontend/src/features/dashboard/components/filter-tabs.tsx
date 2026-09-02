import { DocFilterTab } from '@/types/dokudocs'
import { Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDokudocs } from '@/features/dashboard/hooks/use-dokudocs'

export function FilterTabs() {
  const { documents, filterTab, setFilterTab, activeOrgId } = useDokudocs()

  const orgDocs = documents.filter(
    (d) => d.orgId === activeOrgId && !d.deletedAt
  )

  const counts = {
    all: orgDocs.length,
    created_by_me: orgDocs.filter((d) => d.author.id === 'usr-1').length,
    shared: orgDocs.filter((d) => d.isShared).length,
    starred: orgDocs.filter((d) => d.isStarred).length,
  }

  const tabs: {
    id: DocFilterTab
    label: string
    count: number
    icon?: boolean
  }[] = [
    { id: 'all', label: 'All', count: counts.all },
    {
      id: 'created_by_me',
      label: 'Created by me',
      count: counts.created_by_me,
    },
    { id: 'shared', label: 'Shared with me', count: counts.shared },
    { id: 'starred', label: 'Starred', count: counts.starred, icon: true },
  ]

  return (
    <div className='flex flex-wrap items-center gap-1.5'>
      {tabs.map((tab) => {
        const isActive = filterTab === tab.id
        return (
          <Button
            key={tab.id}
            variant={isActive ? 'secondary' : 'ghost'}
            size='sm'
            onClick={() => setFilterTab(tab.id)}
            className={`h-8 rounded-full px-3 text-xs font-medium transition-all ${
              isActive
                ? 'bg-secondary font-semibold text-secondary-foreground shadow-2xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.icon && (
              <Star
                className={`mr-1 size-3.5 ${
                  isActive ? 'fill-amber-400 text-amber-500' : ''
                }`}
              />
            )}
            <span>{tab.label}</span>
            <span
              className={`py-0.2 ml-1.5 rounded-full px-1.5 text-[10px] ${
                isActive
                  ? 'bg-background/80 font-bold text-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {tab.count}
            </span>
          </Button>
        )
      })}
    </div>
  )
}
