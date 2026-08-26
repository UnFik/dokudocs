import { useState } from 'react'
import { FileEdit, LayoutGrid, List, Plus, Search, Upload } from 'lucide-react'
import { DocType } from '@/types/dokudocs'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CreateDocDialog } from '@/features/docs/components/create-doc-dialog'
import { DocCard } from '@/features/docs/components/doc-card'
import { DocListRow } from '@/features/docs/components/doc-list-row'
import { ImportDocDialog } from '@/features/docs/components/import-doc-dialog'
import { DraftsEmptyState } from './components/drafts-empty-state'

export function DraftsPage() {
  const { documents, activeOrgId, viewMode, setViewMode } = useDokudocsStore()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | DocType>('all')

  const draftDocs = (documents || []).filter(
    (doc) =>
      (doc.isDraft || !doc.projectId) &&
      !doc.deletedAt &&
      doc.orgId === activeOrgId
  )

  const filteredDrafts = draftDocs.filter((doc) => {
    const matchesSearch = doc.title
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
    const matchesType = typeFilter === 'all' || doc.type === typeFilter
    return matchesSearch && matchesType
  })

  return (
    <div className='flex flex-1 flex-col gap-6 p-6'>
      <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-5'>
        <div>
          <div className='flex items-center gap-2.5'>
            <div className='flex size-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400'>
              <FileEdit className='size-4' />
            </div>
            <h1 className='text-xl font-bold tracking-tight text-foreground'>
              My Drafts
            </h1>
            <span className='rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground'>
              {draftDocs.length}
            </span>
          </div>
          <p className='mt-1 text-xs text-muted-foreground'>
            Personal and unassigned scratchpad documents before publishing into projects.
          </p>
        </div>

        <div className='flex items-center gap-2 self-start sm:self-auto'>
          <Button
            variant='outline'
            size='sm'
            className='h-8 text-xs gap-1.5 shadow-xs'
            onClick={() => setImportDialogOpen(true)}
          >
            <Upload className='size-3.5' />
            <span>Import</span>
          </Button>

          <Button
            size='sm'
            className='h-8 text-xs gap-1.5 shadow-xs'
            onClick={() => setCreateDialogOpen(true)}
          >
            <Plus className='size-3.5' />
            <span>New Draft</span>
          </Button>
        </div>
      </div>

      {draftDocs.length > 0 && (
        <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3'>
          <div className='flex items-center gap-2 flex-1 max-w-md'>
            <div className='relative w-full'>
              <Search className='absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground' />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='Search drafts...'
                className='h-8 pl-8 text-xs'
              />
            </div>
          </div>

          <div className='flex items-center gap-2.5 self-end sm:self-auto'>
            <Tabs
              value={typeFilter}
              onValueChange={(val) => setTypeFilter(val as 'all' | DocType)}
            >
              <TabsList className='h-8 p-0.5 bg-muted/60'>
                <TabsTrigger value='all' className='h-7 text-xs px-2.5'>
                  All
                </TabsTrigger>
                <TabsTrigger value='markdown' className='h-7 text-xs px-2.5'>
                  MD
                </TabsTrigger>
                <TabsTrigger value='dbdiagram' className='h-7 text-xs px-2.5'>
                  DB
                </TabsTrigger>
                <TabsTrigger value='mermaid' className='h-7 text-xs px-2.5'>
                  Flow
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className='flex items-center rounded-md border border-border/80 p-0.5'>
              <Button
                variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                size='icon'
                className='size-7'
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid className='size-3.5' />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                size='icon'
                className='size-7'
                onClick={() => setViewMode('list')}
              >
                <List className='size-3.5' />
              </Button>
            </div>
          </div>
        </div>
      )}

      {draftDocs.length === 0 ? (
        <DraftsEmptyState />
      ) : filteredDrafts.length === 0 ? (
        <div className='flex min-h-[30vh] flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-8 text-center'>
          <p className='text-xs text-muted-foreground'>
            No drafts matching your search or filters.
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {filteredDrafts.map((doc) => (
            <DocCard key={doc.id} document={doc} />
          ))}
        </div>
      ) : (
        <div className='flex flex-col gap-2'>
          {filteredDrafts.map((doc) => (
            <DocListRow key={doc.id} document={doc} />
          ))}
        </div>
      )}

      <CreateDocDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        preselectedProjectId={null}
      />

      <ImportDocDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        preselectedProjectId={null}
      />
    </div>
  )
}
