import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { DocumentItem } from '@/types/dokudocs'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import {
  listDocumentRevisions,
  restoreDocumentRevision,
} from '@/lib/domain-api'
import { formatRelativeTime } from '@/lib/time-utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { DocTypeBadge } from '@/features/docs/components/doc-type-badge'
import {
  createArchitectureVersion,
  deleteArchitectureVersion,
  listArchitectureVersions,
  updateArchitectureVersion,
  type ArchitectureVersion,
} from '../api/architecture-api'
import { diffCanvases, mergeForDiff } from '../lib/canvas-diff'
import type { ArchitectureJSON } from '../lib/canvas-model'
import {
  ArchitecturePreview,
  DiffLegend,
  parseCanvas,
} from './architecture-preview'

const CURRENT = 'current'

/**
 * Architecture versions (ADR 0032): tag the canvas with its linked documents,
 * open a version, compare two, restore the canvas, rename, delete.
 */
export function ArchitectureVersions({
  open,
  onOpenChange,
  workspaceID,
  document,
  canEdit,
  currentCanvas,
  onRestored,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceID: string
  document: DocumentItem
  canEdit: boolean
  currentCanvas: ArchitectureJSON
  onRestored: () => Promise<void>
}) {
  const queryClient = useQueryClient()
  const versionsKey = ['architecture-versions', workspaceID, document.id]
  const versions = useQuery({
    queryKey: versionsKey,
    queryFn: ({ signal }) =>
      listArchitectureVersions(workspaceID, document.id, signal),
    enabled: open,
  })
  const revisions = useQuery({
    queryKey: ['document-revisions', workspaceID, document.id],
    queryFn: ({ signal }) =>
      listDocumentRevisions(workspaceID, document.id, signal),
    enabled: open,
  })
  const [selectedID, setSelectedID] = useState<string | null>(null)
  const [compareWith, setCompareWith] = useState<string>('')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const selected =
    versions.data?.find((v) => v.id === selectedID) ?? versions.data?.[0]

  const canvasOf = (
    version: ArchitectureVersion | undefined
  ): ArchitectureJSON | null => {
    if (!version) return null
    const revision = revisions.data?.find((r) => r.id === version.revisionId)
    return revision ? parseCanvas(revision.contentJSON) : null
  }
  const selectedCanvas = canvasOf(selected)
  const otherCanvas =
    compareWith === CURRENT
      ? currentCanvas
      : canvasOf(versions.data?.find((v) => v.id === compareWith))
  const diff = useMemo(() => {
    if (!selectedCanvas || !otherCanvas) return null
    // Older first: what changed going from the selected version to the other one.
    return {
      map: diffCanvases(selectedCanvas, otherCanvas),
      canvas: mergeForDiff(selectedCanvas, otherCanvas),
    }
  }, [selectedCanvas, otherCanvas])

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: versionsKey }),
      queryClient.invalidateQueries({
        queryKey: ['document-revisions', workspaceID, document.id],
      }),
    ])
  const tag = useMutation({
    mutationFn: () =>
      createArchitectureVersion(
        workspaceID,
        document.id,
        label.trim(),
        description.trim()
      ),
    onSuccess: async (version) => {
      setLabel('')
      setDescription('')
      setSelectedID(version.id)
      await refresh()
      const pinned = version.pins.filter((p) => p.revisionId).length
      const missed = version.pins.length - pinned
      toast.success(
        `Version “${version.label}” tagged with ${pinned} linked document${pinned === 1 ? '' : 's'} frozen${missed ? `; ${missed} you cannot open stay unfrozen` : ''}.`
      )
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError && error.status === 409
          ? 'A version with this label exists. Choose another label.'
          : error.message
      ),
  })
  const restore = useMutation({
    mutationFn: (version: ArchitectureVersion) =>
      restoreDocumentRevision(
        workspaceID,
        document.id,
        version.revisionId,
        crypto.randomUUID()
      ),
    onSuccess: async (_r, version) => {
      await onRestored()
      await refresh()
      toast.success(
        `Canvas restored to “${version.label}”. Linked documents keep their own history.`
      )
    },
    onError: (error) => toast.error(error.message),
  })
  const rename = useMutation({
    mutationFn: ({
      version,
      nextLabel,
      nextDescription,
    }: {
      version: ArchitectureVersion
      nextLabel: string
      nextDescription: string
    }) =>
      updateArchitectureVersion(
        workspaceID,
        document.id,
        version.id,
        nextLabel,
        nextDescription
      ),
    onSuccess: refresh,
    onError: (error) =>
      toast.error(
        error instanceof ApiError && error.status === 409
          ? 'A version with this label exists.'
          : error.message
      ),
  })
  const remove = useMutation({
    mutationFn: (version: ArchitectureVersion) =>
      deleteArchitectureVersion(workspaceID, document.id, version.id),
    onSuccess: async () => {
      setSelectedID(null)
      await refresh()
      toast.success(
        'Version deleted. The revisions it made stay in each document’s history.'
      )
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError && error.status === 403
          ? 'Only an owner of this canvas can delete a version.'
          : error.message
      ),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-4xl'>
        <DialogHeader>
          <DialogTitle>Versions of {document.title}</DialogTitle>
          <DialogDescription>
            A version freezes the canvas and every linked document you can open,
            so “{document.title} v2.0” keeps its API spec and schema as they
            were.
          </DialogDescription>
        </DialogHeader>

        {canEdit && (
          <form
            className='flex flex-wrap items-end gap-2 border-b border-border pb-3'
            onSubmit={(event) => {
              event.preventDefault()
              if (label.trim()) tag.mutate()
            }}
          >
            <div className='flex flex-col gap-1'>
              <label
                htmlFor='architecture-version-label'
                className='font-mono text-[11px] text-muted-foreground'
              >
                label
              </label>
              <Input
                id='architecture-version-label'
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder='v1.0.0'
                maxLength={80}
                className='h-8 w-40 text-[12.5px]'
                required
              />
            </div>
            <div className='flex min-w-48 flex-1 flex-col gap-1'>
              <label
                htmlFor='architecture-version-description'
                className='font-mono text-[11px] text-muted-foreground'
              >
                what changed (optional)
              </label>
              <Input
                id='architecture-version-description'
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                className='h-8 text-[12.5px]'
              />
            </div>
            <Button
              type='submit'
              size='sm'
              disabled={tag.isPending || !label.trim()}
            >
              {tag.isPending ? 'Tagging…' : 'Tag version'}
            </Button>
          </form>
        )}

        {versions.isPending && (
          <p className='text-sm text-muted-foreground'>Loading versions…</p>
        )}
        {versions.isError && (
          <p className='text-sm'>
            Versions could not be loaded.{' '}
            <button
              type='button'
              className='underline'
              onClick={() => void versions.refetch()}
            >
              Try again
            </button>
          </p>
        )}
        {versions.data && !versions.data.length && (
          <p className='text-sm text-muted-foreground'>
            No versions yet.{' '}
            {canEdit
              ? 'Tag the canvas when it reaches a state worth keeping, such as a release.'
              : 'An editor can tag one.'}
          </p>
        )}
        {versions.data && versions.data.length > 0 && (
          <div className='grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]'>
            <ul className='flex flex-col' aria-label='Versions'>
              {versions.data.map((v) => (
                <li key={v.id}>
                  <button
                    type='button'
                    aria-current={selected?.id === v.id}
                    onClick={() => setSelectedID(v.id)}
                    className='flex w-full flex-col items-start gap-0.5 border-b border-border px-2 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-signal aria-[current=true]:bg-accent'
                  >
                    <span className='text-[13px] font-medium aria-[current=true]:text-signal'>
                      {v.label}
                    </span>
                    <span className='font-mono text-[11px] text-muted-foreground'>
                      {formatRelativeTime(v.createdAt)} ·{' '}
                      {v.createdByName || 'someone'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {selected && (
              <VersionDetail
                key={selected.id}
                version={selected}
                versions={versions.data}
                canvas={selectedCanvas}
                diff={diff}
                compareWith={compareWith}
                onCompare={setCompareWith}
                canEdit={canEdit}
                workspaceID={workspaceID}
                restoring={restore.isPending}
                onRestore={() => restore.mutate(selected)}
                onRename={(nextLabel, nextDescription) =>
                  rename.mutate({
                    version: selected,
                    nextLabel,
                    nextDescription,
                  })
                }
                onDelete={() => remove.mutate(selected)}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function VersionDetail({
  version,
  versions,
  canvas,
  diff,
  compareWith,
  onCompare,
  canEdit,
  workspaceID,
  restoring,
  onRestore,
  onRename,
  onDelete,
}: {
  version: ArchitectureVersion
  versions: ArchitectureVersion[]
  canvas: ArchitectureJSON | null
  diff: {
    map: Map<string, 'added' | 'removed' | 'changed'>
    canvas: ArchitectureJSON
  } | null
  compareWith: string
  onCompare: (id: string) => void
  canEdit: boolean
  workspaceID: string
  restoring: boolean
  onRestore: () => void
  onRename: (label: string, description: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(version.label)
  const [description, setDescription] = useState(version.description)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  return (
    <div className='flex min-w-0 flex-col gap-3'>
      {editing ? (
        <form
          className='flex flex-col gap-2'
          onSubmit={(event) => {
            event.preventDefault()
            onRename(label.trim(), description.trim())
            setEditing(false)
          }}
        >
          <label
            htmlFor='architecture-version-rename'
            className='font-mono text-[11px] text-muted-foreground'
          >
            label
          </label>
          <Input
            id='architecture-version-rename'
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            maxLength={80}
            className='h-8 text-[12.5px]'
          />
          <label
            htmlFor='architecture-version-redescribe'
            className='font-mono text-[11px] text-muted-foreground'
          >
            what changed
          </label>
          <Textarea
            id='architecture-version-redescribe'
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            className='min-h-14 text-[12.5px]'
          />
          <div className='flex gap-2'>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button type='submit' size='sm' variant='outline'>
              Save
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <h3 className='text-base font-semibold'>{version.label}</h3>
          {version.description && (
            <p className='text-sm text-muted-foreground'>
              {version.description}
            </p>
          )}
          <p className='font-mono text-[11px] text-muted-foreground'>
            canvas revision v{version.revisionNumber}
          </p>
        </div>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <label
          htmlFor='architecture-version-compare'
          className='font-mono text-[11px] text-muted-foreground'
        >
          compare with
        </label>
        <select
          id='architecture-version-compare'
          value={compareWith}
          onChange={(e) => onCompare(e.target.value)}
          className='h-8 rounded-[4px] border border-input bg-card px-2 text-[12.5px] focus-visible:outline-2 focus-visible:outline-signal'
        >
          <option value=''>Nothing: show this version</option>
          <option value={CURRENT}>The canvas now</option>
          {versions
            .filter((v) => v.id !== version.id)
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
        </select>
      </div>
      {!canvas ? (
        <p className='text-sm text-muted-foreground'>
          Loading this version’s canvas…
        </p>
      ) : diff ? (
        <div className='flex flex-col gap-2'>
          <DiffLegend />
          <ArchitecturePreview
            canvas={diff.canvas}
            diff={diff.map}
            className='max-h-80 rounded-[6px] border border-border'
            label={`Changes from ${version.label}`}
          />
          {!diff.map.size && (
            <p className='text-xs text-muted-foreground'>
              No element changed, beyond positions.
            </p>
          )}
        </div>
      ) : (
        <ArchitecturePreview
          canvas={canvas}
          className='max-h-80 rounded-[6px] border border-border'
          label={`Canvas at ${version.label}`}
        />
      )}

      <section aria-labelledby='architecture-pins'>
        <h4
          id='architecture-pins'
          className='mb-1 font-mono text-[11px] text-muted-foreground'
        >
          linked documents · {version.pins.length}
        </h4>
        {!version.pins.length && (
          <p className='text-xs text-muted-foreground'>
            No documents were linked when this version was tagged.
          </p>
        )}
        <ul>
          {version.pins.map((pin) => (
            <li
              key={pin.documentId}
              className='flex flex-col gap-1 border-t border-border py-1.5 text-[12.5px]'
            >
              <div className='flex flex-wrap items-center gap-2'>
                {(pin.documentType === 'markdown' ||
                  pin.documentType === 'dbdiagram' ||
                  pin.documentType === 'mermaid') && (
                  <DocTypeBadge type={pin.documentType} />
                )}
                <span className='flex-1 truncate'>{pin.title}</span>
                {pin.revisionId ? (
                  <>
                    <span className='font-mono text-[11px] text-muted-foreground'>
                      rev v{pin.versionNumber}
                    </span>
                    <span className='inline-flex items-center gap-1 text-xs'>
                      <span
                        aria-hidden
                        className='size-1.5 rounded-[1px] bg-ok'
                      />
                      frozen
                    </span>
                    <button
                      type='button'
                      className='text-xs text-signal hover:underline'
                      aria-expanded={preview === pin.documentId}
                      onClick={() =>
                        setPreview(
                          preview === pin.documentId ? null : pin.documentId
                        )
                      }
                    >
                      {preview === pin.documentId ? 'Hide' : 'Show as it was'}
                    </button>
                  </>
                ) : (
                  <span className='text-xs text-muted-foreground'>
                    not frozen: the tagger could not open it
                  </span>
                )}
                <Link
                  to='/docs/$docId'
                  params={{ docId: pin.documentId }}
                  className='text-xs text-signal hover:underline'
                >
                  Open now
                </Link>
              </div>
              {preview === pin.documentId && pin.revisionId && (
                <PinnedRevision
                  workspaceID={workspaceID}
                  documentID={pin.documentId}
                  revisionID={pin.revisionId}
                />
              )}
            </li>
          ))}
        </ul>
      </section>

      {canEdit && (
        <div className='flex flex-wrap gap-2 border-t border-border pt-3'>
          <Button
            size='sm'
            variant='outline'
            disabled={restoring}
            onClick={onRestore}
          >
            {restoring ? 'Restoring…' : 'Restore the canvas to this version'}
          </Button>
          <Button size='sm' variant='ghost' onClick={() => setEditing(true)}>
            Rename
          </Button>
          {confirmDelete ? (
            <span className='flex items-center gap-2 text-xs'>
              Delete “{version.label}”? Its revisions stay in history.
              <Button
                size='sm'
                variant='ghost'
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
              <Button
                size='sm'
                variant='outline'
                className='text-destructive hover:border-destructive'
                onClick={onDelete}
              >
                Delete
              </Button>
            </span>
          ) : (
            <Button
              size='sm'
              variant='ghost'
              className='text-destructive'
              onClick={() => setConfirmDelete(true)}
            >
              Delete version
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function PinnedRevision({
  workspaceID,
  documentID,
  revisionID,
}: {
  workspaceID: string
  documentID: string
  revisionID: string
}) {
  const revisions = useQuery({
    queryKey: ['document-revisions', workspaceID, documentID],
    queryFn: ({ signal }) =>
      listDocumentRevisions(workspaceID, documentID, signal),
  })
  if (revisions.isPending)
    return <p className='text-xs text-muted-foreground'>Loading…</p>
  if (revisions.isError)
    return (
      <p className='text-xs'>
        This revision could not be loaded; you may no longer have access.
      </p>
    )
  const revision = revisions.data.find((r) => r.id === revisionID)
  if (!revision)
    return (
      <p className='text-xs text-muted-foreground'>
        This revision is no longer available.
      </p>
    )
  return (
    <pre className='max-h-40 overflow-auto rounded-[4px] border border-border bg-muted/40 p-2 font-mono text-[11px] whitespace-pre-wrap'>
      {revision.content.slice(0, 2000)}
      {revision.content.length > 2000 && '\n…'}
    </pre>
  )
}
