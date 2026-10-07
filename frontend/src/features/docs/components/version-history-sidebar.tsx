import { useState, useMemo } from 'react'
import type { DocumentRevision } from '@/types/dokudocs'
import {
  History,
  RotateCcw,
  Plus,
  X,
  Calendar,
  User,
  FileText,
  Bookmark,
  MoreVertical,
  Pencil,
  Check,
} from 'lucide-react'
import { toast } from 'sonner'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { formatRelativeTime } from '@/lib/time-utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { documentBodyToMarkdown } from '../lib/muya/state/documentBodyToMarkdown'
import { changesBetween } from '../lib/revision-changes'
import { RevisionChanges } from './revision-changes'

interface VersionHistorySidebarProps {
  docId: string
  isOpen: boolean
  onClose: () => void
  onRestoreContent?: (content: string) => void
  revisions?: DocumentRevision[]
  canEdit?: boolean
  isLoading?: boolean
  loadError?: string
  isSaving?: boolean
  isRestoring?: boolean
  onCreateSnapshot?: (title: string) => Promise<DocumentRevision>
  onRestoreRevision?: (revision: DocumentRevision) => void
  /** Draws the selected revision instead of its text, for documents that are not Markdown. */
  renderPreview?: (revision: DocumentRevision) => React.ReactNode
}

function revisionMarkdown(revision: DocumentRevision | null | undefined) {
  if (!revision) return ''
  if (!revision.astSnapshot) return revision.content
  try {
    return documentBodyToMarkdown(revision.astSnapshot.nodes)
  } catch {
    return 'This revision cannot be previewed with the current Markdown renderer.'
  }
}

function formatRevisionTime(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function VersionHistorySidebar({
  docId,
  isOpen,
  onClose,
  onRestoreContent,
  revisions,
  canEdit = true,
  isLoading = false,
  loadError = '',
  isSaving = false,
  isRestoring = false,
  onCreateSnapshot,
  onRestoreRevision,
  renderPreview,
}: VersionHistorySidebarProps) {
  const revisionsMap = useDokudocsStore((s) => s.revisions)
  const restoreRevision = useDokudocsStore((s) => s.restoreRevision)
  const createRevisionSnapshot = useDokudocsStore(
    (s) => s.createRevisionSnapshot
  )
  const renameRevision = useDokudocsStore((s) => s.renameRevision)

  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(
    null
  )
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false)
  const [snapshotTitle, setSnapshotTitle] = useState('')
  const [onlyNamed, setOnlyNamed] = useState(false)
  const [editingRevisionId, setEditingRevisionId] = useState<string | null>(
    null
  )
  const [editTitle, setEditTitle] = useState('')

  const docRevisions = useMemo(
    () => revisions ?? revisionsMap[docId] ?? [],
    [revisions, revisionsMap, docId]
  )
  const isRemote = revisions !== undefined

  const displayedRevisions = useMemo(() => {
    if (!onlyNamed) return docRevisions
    return docRevisions.filter((r) => r.isNamed)
  }, [docRevisions, onlyNamed])

  // Derive active revision or default to first
  const selectedRevision = useMemo(() => {
    if (!displayedRevisions.length) return null
    if (selectedRevisionId) {
      return (
        displayedRevisions.find((r) => r.id === selectedRevisionId) ||
        displayedRevisions[0]
      )
    }
    return displayedRevisions[0]
  }, [displayedRevisions, selectedRevisionId])
  const selectedRevisionContent = useMemo(
    () => revisionMarkdown(selectedRevision),
    [selectedRevision]
  )
  // The list is newest first, so the version before is the next one down.
  const changes = useMemo(() => {
    if (!selectedRevision) return []
    const index = docRevisions.findIndex((r) => r.id === selectedRevision.id)
    return changesBetween(
      revisionMarkdown(docRevisions[index + 1] ?? null),
      selectedRevisionContent
    )
  }, [docRevisions, selectedRevision, selectedRevisionContent])

  if (!isOpen) return null

  const handleRestore = (revision: DocumentRevision) => {
    if (onRestoreRevision) {
      onRestoreRevision(revision)
      return
    }
    restoreRevision(docId, revision.id)
    if (onRestoreContent) {
      onRestoreContent(revision.content)
    }
    toast.success(`Restored to version ${revision.versionNumber}`)
  }

  const handleCreateSnapshot = async () => {
    if (!snapshotTitle.trim()) {
      toast.error('Please enter a revision title')
      return
    }
    if (onCreateSnapshot) {
      try {
        const created = await onCreateSnapshot(snapshotTitle.trim())
        setSelectedRevisionId(created.id)
        setSnapshotTitle('')
        setIsCreatingSnapshot(false)
        toast.success(`Created named version v${created.versionNumber}`)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Could not save revision'
        )
      }
      return
    }
    const created = createRevisionSnapshot(docId, snapshotTitle.trim())
    if (created) {
      setSelectedRevisionId(created.id)
      setSnapshotTitle('')
      setIsCreatingSnapshot(false)
      toast.success(`Created named version v${created.versionNumber}`)
    }
  }

  const handleStartRename = (rev: DocumentRevision) => {
    setEditingRevisionId(rev.id)
    setEditTitle(rev.title || '')
  }

  const handleSaveRename = (rev: DocumentRevision) => {
    renameRevision(docId, rev.id, editTitle)
    setEditingRevisionId(null)
    toast.success('Version title saved')
  }

  return (
    <aside className='fixed inset-y-0 right-0 z-40 flex w-80 flex-col border-s border-border/80 bg-background/95 transition-all sm:w-96'>
      {/* Header */}
      <div className='flex h-14 items-center justify-between border-b border-border/80 px-4'>
        <div className='flex items-center gap-2'>
          <History className='size-4 text-primary' />
          <h2 className='text-sm font-semibold text-foreground'>
            Version History
          </h2>
          <span className='rounded-sm bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground'>
            {displayedRevisions.length}
          </span>
        </div>
        <div className='flex items-center gap-1'>
          {canEdit && (
            <Button
              variant='ghost'
              size='icon'
              className='size-7'
              onClick={() => setIsCreatingSnapshot(!isCreatingSnapshot)}
              title='Create Named Milestone'
              disabled={isSaving}
            >
              <Plus className='size-4' />
            </Button>
          )}
          <Button
            variant='ghost'
            size='icon'
            className='size-7'
            onClick={onClose}
            title='Close'
          >
            <X className='size-4' />
          </Button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className='flex items-center justify-between border-b border-border/70 bg-muted/20 px-3 py-1.5 text-xs'>
        <span className='text-[11px] font-medium text-muted-foreground'>
          {onlyNamed ? 'Showing named versions' : 'All auto-saved sessions'}
        </span>
        <button
          type='button'
          onClick={() => setOnlyNamed(!onlyNamed)}
          className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
            onlyNamed
              ? 'border border-primary/30 bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          <Bookmark className='size-3' />
          <span>Only named</span>
        </button>
      </div>

      {/* Optional Create Snapshot Form */}
      {isCreatingSnapshot && canEdit && (
        <div className='border-b border-border/70 bg-muted/30 p-3'>
          <p className='mb-2 text-xs font-medium text-muted-foreground'>
            Create a named milestone for current content:
          </p>
          <div className='flex gap-2'>
            <Input
              value={snapshotTitle}
              onChange={(e) => setSnapshotTitle(e.target.value)}
              placeholder='e.g., v1.2 Pre-release draft'
              className='h-7 text-xs'
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateSnapshot()
                if (e.key === 'Escape') setIsCreatingSnapshot(false)
              }}
              autoFocus
            />
            <Button
              size='sm'
              className='h-7 px-2 text-xs'
              onClick={() => void handleCreateSnapshot()}
              disabled={isSaving}
            >
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}

      {/* Revisions List */}
      <div className='flex flex-1 flex-col overflow-hidden'>
        <ScrollArea className='flex-1 p-3'>
          {loadError ? (
            <p
              role='alert'
              className='py-8 text-center text-xs text-destructive'
            >
              {loadError}
            </p>
          ) : isLoading ? (
            <p
              role='status'
              className='py-8 text-center text-xs text-muted-foreground'
            >
              Loading version history…
            </p>
          ) : displayedRevisions.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-12 text-center text-xs text-muted-foreground'>
              <History className='mb-2 size-8 text-muted-foreground/50' />
              <p className='font-medium'>
                {onlyNamed
                  ? 'No named versions found'
                  : 'No versions recorded yet'}
              </p>
              <p className='mt-1 text-[11px]'>
                {onlyNamed
                  ? 'Turn off the filter or name an existing version.'
                  : 'Edits are automatically grouped and saved as you type.'}
              </p>
            </div>
          ) : (
            <div className='space-y-2'>
              {displayedRevisions.map((rev) => {
                const isSelected = selectedRevision?.id === rev.id
                const canRestore =
                  canEdit &&
                  !isRestoring &&
                  (!isRemote || Boolean(rev.astSnapshot))
                return (
                  <div
                    key={rev.id}
                    onClick={() => setSelectedRevisionId(rev.id)}
                    className={`cursor-pointer rounded-lg border p-3 text-xs transition-all ${
                      isSelected
                        ? 'border-primary/60 bg-primary/5'
                        : 'border-border/60 bg-card/60 hover:border-border hover:bg-card'
                    }`}
                  >
                    {editingRevisionId === rev.id ? (
                      <div
                        className='flex items-center gap-1.5'
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder='Name this version...'
                          className='h-6 text-xs'
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename(rev)
                            if (e.key === 'Escape') setEditingRevisionId(null)
                          }}
                        />
                        <Button
                          size='icon'
                          className='size-6 shrink-0'
                          onClick={() => handleSaveRename(rev)}
                          title='Save title'
                        >
                          <Check className='size-3' />
                        </Button>
                        <Button
                          size='icon'
                          variant='ghost'
                          className='size-6 shrink-0'
                          onClick={() => setEditingRevisionId(null)}
                          title='Cancel'
                        >
                          <X className='size-3' />
                        </Button>
                      </div>
                    ) : (
                      <div className='flex items-start justify-between gap-1'>
                        <div className='min-w-0 flex-1'>
                          <div className='flex items-center gap-1.5'>
                            <span className='truncate font-semibold text-foreground'>
                              {rev.title
                                ? rev.title
                                : `v${rev.versionNumber} · ${formatRevisionTime(
                                    rev.updatedAt || rev.createdAt
                                  )}`}
                            </span>
                            {rev.isNamed && (
                              <span className='shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary'>
                                Named
                              </span>
                            )}
                          </div>
                          {!rev.isNamed && (
                            <span className='block text-[10px] text-muted-foreground'>
                              Auto-saved session
                            </span>
                          )}
                        </div>

                        <div
                          className='flex shrink-0 items-center gap-0.5'
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className='mr-1 text-[10px] text-muted-foreground'>
                            {formatRelativeTime(rev.updatedAt || rev.createdAt)}
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant='ghost'
                                size='icon'
                                className='size-6 text-muted-foreground hover:text-foreground'
                                title='Options'
                              >
                                <MoreVertical className='size-3.5' />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align='end'
                              className='w-38 text-xs'
                            >
                              {!isRemote && (
                                <DropdownMenuItem
                                  className='gap-2 text-xs'
                                  onClick={() => handleStartRename(rev)}
                                >
                                  <Pencil className='size-3' />
                                  <span>
                                    {rev.isNamed
                                      ? 'Rename version'
                                      : 'Name this version'}
                                  </span>
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                disabled={!canRestore}
                                className='gap-2 text-xs'
                                onClick={() => handleRestore(rev)}
                              >
                                <RotateCcw className='size-3' />
                                <span>Restore version</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    )}

                    <div className='mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground'>
                      <div className='flex items-center gap-1'>
                        <User className='size-3' />
                        <span>
                          {rev.author?.name ?? rev.authorId ?? 'Unknown'}
                        </span>
                      </div>
                      <div className='flex items-center gap-1'>
                        <Calendar className='size-3' />
                        <span>
                          {new Date(rev.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    {isSelected && (
                      <div className='mt-3 flex items-center justify-between border-t border-border/50 pt-2'>
                        <span className='flex items-center gap-1 text-[10px] text-primary'>
                          <FileText className='size-3' /> Selected for preview
                        </span>
                        <Button
                          size='sm'
                          variant='outline'
                          className='h-6 gap-1 px-2 text-[11px] font-medium'
                          disabled={!canRestore}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRestore(rev)
                          }}
                        >
                          <RotateCcw className='size-3' />
                          <span>Restore</span>
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>

        {/* Preview Panel for selected revision */}
        {selectedRevision && (
          <div className='border-t border-border/80 bg-muted/20 p-3'>
            <div className='mb-1.5 flex items-center justify-between text-xs'>
              <span className='font-semibold text-foreground'>
                Preview (v{selectedRevision.versionNumber})
              </span>
              <span className='font-mono text-[10px] text-muted-foreground'>
                {selectedRevisionContent.length} chars
              </span>
            </div>
            {renderPreview ? (
              renderPreview(selectedRevision)
            ) : (
              <>
                <RevisionChanges key={selectedRevision.id} changes={changes} />
                <pre className='mt-2 max-h-36 overflow-auto rounded-md border border-border/60 bg-background/80 p-2 font-mono text-[10px] whitespace-pre-wrap text-muted-foreground select-all'>
                  {selectedRevisionContent.slice(0, 500)}
                  {selectedRevisionContent.length > 500 && '\n...'}
                </pre>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
