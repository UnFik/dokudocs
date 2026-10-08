import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DocumentItem, DocumentRevision } from '@/types/dokudocs'
import {
  getNodesBounds,
  getViewportForBounds,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import { toPng, toSvg } from 'html-to-image'
import { PanelLeft, PanelRight } from 'lucide-react'
import { toast } from 'sonner'
import {
  createNamedDocumentRevision,
  listDocumentRevisions,
  restoreDocumentRevision,
  updateDocumentMetadata,
} from '@/lib/domain-api'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useCurrentProfile } from '@/features/auth/hooks/use-current-profile'
import { PublicShareDialog } from '@/features/docs/components/dialogs/public-share-dialog'
import { EditorHeader } from '@/features/docs/components/editor-header'
import { VersionHistorySidebar } from '@/features/docs/components/version-history-sidebar'
import { clearLocalCopy } from '@/features/docs/lib/collab-session'
import { readEditorPrefs, writeEditorPref } from '../api/editor-prefs-api'
import { useArchitectureSession } from '../hooks/use-architecture-session'
import { useCatalog } from '../hooks/use-catalog'
import {
  addFromPalette,
  toLayoutNodes,
  type PaletteItem,
} from '../lib/canvas-actions'
import { createUndo, removeElement, updateConnection } from '../lib/canvas-doc'
import { architectureLimits } from '../lib/canvas-model'
import { confirmationFor, type Selected } from '../lib/canvas-selection'
import { protocolFamilies, suggestedProtocols } from '../lib/catalog'
import type { PinAnchor } from '../lib/comment-pins'
import { absoluteRect } from '../lib/layout'
import { ArchitectureCanvas, type Selection } from './architecture-canvas'
import { ArchitecturePreview, parseCanvas } from './architecture-preview'
import { ArchitectureVersions } from './architecture-versions'
import { CatalogPalette } from './catalog-palette'
import { CatalogRequests } from './catalog-requests'
import { CommentPins } from './comment-pins'
import { commentsKey } from './element-comments'
import { PropertiesPanel } from './properties-panel'

const WARN_AT = 0.8

export function ArchitectureDocEditor(props: {
  document: DocumentItem
  workspaceID: string
  userID: string
  userName?: string
  focusNodeID?: string
}) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  )
}

function download(name: string, href: string) {
  const link = document.createElement('a')
  link.href = href
  link.download = name
  link.click()
}

function Editor({
  document: doc,
  workspaceID,
  userID,
  focusNodeID,
}: {
  document: DocumentItem
  workspaceID: string
  userID: string
  userName?: string
  focusNodeID?: string
}) {
  const queryClient = useQueryClient()
  const { name: userName } = useCurrentProfile()
  const flow = useReactFlow()
  const [nonce, setNonce] = useState(0)
  const session = useArchitectureSession({
    workspaceID,
    documentID: doc.id,
    userID,
    userName,
    initial: doc.contentJSON ? parseCanvas(doc.contentJSON) : null,
    nonce,
    onReloaded: () =>
      void clearLocalCopy(workspaceID, doc.id).then(() =>
        setNonce((n) => n + 1)
      ),
    onCommentsChanged: () =>
      void queryClient.invalidateQueries({
        queryKey: commentsKey(workspaceID, doc.id),
      }),
  })
  const catalog = useCatalog()
  const [selection, setSelection] = useState<Selection>([])
  const lastPointerShare = useRef(0)
  const [pendingDelete, setPendingDelete] = useState<{
    elements: Selected[]
    title: string
  } | null>(null)
  // Comment pins: a thread being started, the one whose pin is open, and resolved ones shown or not.
  const [draftPin, setDraftPin] = useState<PinAnchor | null>(null)
  const [activeThread, setActiveThread] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const [protocolFor, setProtocolFor] = useState<{
    id: string
    x: number
    y: number
  } | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isShareOpen, setIsShareOpen] = useState(false)
  const [isVersionsOpen, setIsVersionsOpen] = useState(false)

  const canEdit = Boolean(session.access?.canEdit) && !session.refused
  // Commenters cannot change the canvas but may discuss its elements.
  const canComment = Boolean(
    session.access?.canComment ?? session.access?.canEdit
  )
  const readOnly = !canEdit
  const undo = useMemo(
    () => (session.doc ? createUndo(session.doc) : null),
    [session.doc]
  )
  useEffect(() => () => undo?.destroy(), [undo])
  const gesture = () => undo?.stopCapturing()

  // Panels: open by default, remembered per person across documents and devices.
  const prefs = useQuery({
    queryKey: ['editor-prefs'],
    queryFn: ({ signal }) => readEditorPrefs(signal),
    staleTime: Infinity,
    retry: false,
  })
  const [panels, setPanels] = useState<{ palette?: boolean; props?: boolean }>(
    {}
  )
  const paletteOpen =
    panels.palette ?? prefs.data?.architecture_palette_open !== false
  const propsOpen =
    panels.props ?? prefs.data?.architecture_props_open !== false
  const togglePanel = (which: 'palette' | 'props') => {
    const next = which === 'palette' ? !paletteOpen : !propsOpen
    setPanels((current) => ({ ...current, [which]: next }))
    void writeEditorPref(
      which === 'palette'
        ? 'architecture_palette_open'
        : 'architecture_props_open',
      next
    ).catch(() => {
      toast.error(
        'The panel setting could not be saved; it lasts until you reload.'
      )
    })
  }

  const nodeCount = session.canvas.nodes.length
  const connectionCount = session.canvas.connections.length
  const blocked = readOnly
    ? 'You can view this canvas but not change it.'
    : nodeCount >= architectureLimits.nodes
      ? `This canvas holds the most elements it can (${architectureLimits.nodes}). Remove some to add more.`
      : null
  const warning =
    !blocked && nodeCount >= architectureLimits.nodes * WARN_AT
      ? `${nodeCount} of ${architectureLimits.nodes} elements used.`
      : !blocked && connectionCount >= architectureLimits.connections * WARN_AT
        ? `${connectionCount} of ${architectureLimits.connections} connections used.`
        : null

  const add = (item: PaletteItem, point?: { x: number; y: number }) => {
    if (!session.doc || blocked) return
    let at = point
    if (!at) {
      // Without a drag: into the selected container, or the middle of the view.
      const only = selection.length === 1 ? selection[0] : undefined
      const selected =
        only?.kind === 'node'
          ? session.canvas.nodes.find((n) => n.id === only.id)
          : undefined
      if (selected && selected.kind !== 'system') {
        const r = absoluteRect(toLayoutNodes(session.canvas), selected.id)
        at = { x: r.x + 20, y: r.y + 40 }
      } else {
        const pane = window.document
          .querySelector('.react-flow')
          ?.getBoundingClientRect()
        at = flow.screenToFlowPosition({
          x: (pane?.left ?? 0) + (pane?.width ?? 800) / 2,
          y: (pane?.top ?? 0) + (pane?.height ?? 600) / 2,
        })
      }
    }
    gesture()
    const id = addFromPalette(session.doc, session.canvas, item, at)
    gesture()
    select([{ kind: 'node', id }])
  }

  const select = (next: Selection) => {
    setSelection(next)
    session.share(
      'selection',
      next.map((s) => s.id)
    )
  }

  const remove = (elements: Selected[]) => {
    if (!session.doc || readOnly || !elements.length) return
    const question = confirmationFor(session.canvas, elements)
    if (question) {
      setPendingDelete({ elements, title: question.title })
      return
    }
    commitRemove(elements)
  }
  const commitRemove = (elements: Selected[]) => {
    if (!session.doc) return
    const ids = elements.map((e) => e.id)
    const name =
      elements.length > 1
        ? `${elements.length} elements`
        : (session.canvas.nodes.find((n) => n.id === ids[0])?.name ??
          (session.canvas.connections.some((c) => c.id === ids[0])
            ? 'Connection'
            : 'Element'))
    const named = session.canvas.nodes.filter((n) => ids.includes(n.id)).length
    gesture()
    const removed = removeElement(session.doc, ids)
    gesture()
    select([])
    const inside = removed.nodes - named
    const others =
      inside > 0 ? ` and ${inside} element${inside > 1 ? 's' : ''} inside` : ''
    toast.success(
      `${name}${others} deleted.${removed.linkedDocuments ? ` ${removed.linkedDocuments} linked document${removed.linkedDocuments === 1 ? '' : 's'} stay in the project; only the links went.` : ''}`
    )
  }

  const titleMutation = useMutation({
    mutationFn: (title: string) =>
      updateDocumentMetadata(workspaceID, doc.id, { title }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['document', workspaceID, doc.id],
      }),
    onError: (error) => toast.error(error.message),
  })
  const revisionsQuery = useQuery({
    queryKey: ['document-revisions', workspaceID, doc.id],
    queryFn: ({ signal }) => listDocumentRevisions(workspaceID, doc.id, signal),
    enabled: isHistoryOpen,
    retry: false,
  })
  const createRevision = useMutation({
    mutationFn: (title: string) =>
      createNamedDocumentRevision(workspaceID, doc.id, title),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['document-revisions', workspaceID, doc.id],
      }),
  })
  const restoreIDs = useRef(new Map<string, string>())
  const restore = useMutation({
    mutationFn: ({
      revisionID,
      requestID,
    }: {
      revisionID: string
      requestID: string
    }) => restoreDocumentRevision(workspaceID, doc.id, revisionID, requestID),
    onSuccess: async (_r, { revisionID }) => {
      restoreIDs.current.delete(revisionID)
      await clearLocalCopy(workspaceID, doc.id)
      setNonce((n) => n + 1)
      await queryClient.invalidateQueries({
        queryKey: ['document-revisions', workspaceID, doc.id],
      })
      toast.success('Canvas restored from the revision')
    },
    onError: (error) => toast.error(error.message),
  })
  const restoreRevision = (revision: DocumentRevision) => {
    const requestID = restoreIDs.current.get(revision.id) ?? crypto.randomUUID()
    restoreIDs.current.set(revision.id, requestID)
    restore.mutate({ revisionID: revision.id, requestID })
  }

  const exportImage = async (format: 'png' | 'svg') => {
    const viewport = window.document.querySelector<HTMLElement>(
      '.react-flow__viewport'
    )
    if (!viewport || !session.canvas.nodes.length) {
      toast.error('There is nothing on the canvas to export yet.')
      return
    }
    const bounds = getNodesBounds(flow.getNodes())
    const width = Math.min(4096, Math.max(400, bounds.width + 80))
    const height = Math.min(4096, Math.max(300, bounds.height + 80))
    const vp = getViewportForBounds(bounds, width, height, 0.2, 2, 0.05)
    const options = {
      width,
      height,
      backgroundColor: getComputedStyle(window.document.body).backgroundColor,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
      },
    }
    try {
      const url =
        format === 'png'
          ? await toPng(viewport, options)
          : await toSvg(viewport, options)
      download(`${doc.title || 'architecture'}.${format}`, url)
    } catch {
      toast.error('The image could not be made. Try again, or export JSON.')
    }
  }

  const protocolConnection = protocolFor
    ? session.canvas.connections.find((c) => c.id === protocolFor.id)
    : undefined
  const protocolTarget = protocolConnection
    ? session.canvas.nodes.find((n) => n.id === protocolConnection.target)
    : undefined
  const targetSubkind = protocolTarget?.catalog
    ? catalog.data?.find((e) => e.slug === protocolTarget.catalog)?.subkind
    : undefined

  return (
    <div className='flex h-screen w-full flex-col overflow-hidden bg-background'>
      <EditorHeader
        docId={doc.id}
        title={doc.title}
        type='architecture'
        projectId={doc.projectId ?? null}
        projectName={doc.projectName}
        category={doc.category}
        categories={doc.categories}
        isSaving={titleMutation.isPending}
        isDirty={false}
        lastSaved={new Date(doc.updatedAt)}
        onTitleChange={(title) => titleMutation.mutate(title)}
        presenceUsers={session.presence}
        currentUserID={userID}
        titleReadOnly={!canEdit}
        onToggleHistory={() => setIsHistoryOpen((open) => !open)}
        isHistoryOpen={isHistoryOpen}
        onOpenShare={
          !doc.isDraft && canEdit ? () => setIsShareOpen(true) : undefined
        }
        onExportCode={() => {
          const blob = new Blob([JSON.stringify(session.canvas, null, 2)], {
            type: 'application/json',
          })
          download(
            `${doc.title || 'architecture'}.architecture.json`,
            URL.createObjectURL(blob)
          )
        }}
        onExportPng={() => void exportImage('png')}
        onExportSvg={() => void exportImage('svg')}
      />
      {session.refused && (
        <div
          role='alert'
          className='flex flex-wrap items-center gap-3 border-b border-border bg-muted px-4 py-2 text-sm'
        >
          <span>
            This canvas has reached its limit, so your last change was not
            saved. Remove elements and reload to keep editing.
          </span>
          <Button
            size='sm'
            variant='outline'
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
        </div>
      )}
      {session.status === 'forbidden' && (
        <div role='alert' className='border-b border-border px-4 py-2 text-sm'>
          You no longer have access to this canvas. Ask its owner to share it
          with you.
        </div>
      )}
      <div className='flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground'>
        <span>
          {session.synced
            ? readOnly
              ? 'Viewing'
              : 'Editing together'
            : session.status === 'offline'
              ? 'Offline: changes are kept on this device'
              : 'Connecting…'}
        </span>
        <span aria-hidden>·</span>
        <span className='font-mono tabular-nums'>
          {nodeCount} elements, {connectionCount} connections
        </span>
        <span className='flex-1' />
        <Button
          size='sm'
          variant='outline'
          onClick={() => setIsVersionsOpen(true)}
        >
          Versions
        </Button>
      </div>
      <div
        className={cn(
          'grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_480px_auto] overflow-y-auto transition-[grid-template-columns] duration-150 motion-reduce:transition-none md:grid-rows-1 md:overflow-hidden',
          'md:grid-cols-[var(--palette)_minmax(0,1fr)_var(--props)]'
        )}
        style={{
          ['--palette' as string]: paletteOpen ? '216px' : '40px',
          ['--props' as string]: propsOpen ? '280px' : '40px',
        }}
      >
        <aside
          aria-label='Palette'
          className='flex flex-col gap-2 border-b border-border bg-background p-2 md:min-h-0 md:border-r md:border-b-0'
        >
          <div className='flex items-center justify-between'>
            {paletteOpen && (
              <span className='font-mono text-[11px] text-muted-foreground'>
                palette
              </span>
            )}
            <Button
              size='icon'
              variant='ghost'
              className='size-8'
              aria-expanded={paletteOpen}
              aria-controls='architecture-palette'
              aria-label={
                paletteOpen ? 'Collapse the palette' : 'Expand the palette'
              }
              onClick={() => togglePanel('palette')}
            >
              <PanelLeft className='size-4' strokeWidth={1.5} />
            </Button>
          </div>
          {paletteOpen ? (
            <div
              id='architecture-palette'
              className='flex min-h-0 flex-1 flex-col'
            >
              <CatalogPalette
                workspaceID={workspaceID}
                catalog={catalog.data}
                loading={catalog.isPending}
                error={catalog.isError}
                onRetry={() => void catalog.refetch()}
                onAdd={(item) => add(item)}
                blocked={blocked}
                warning={warning}
              />
              <CatalogRequests catalog={catalog.data ?? []} />
            </div>
          ) : (
            <button
              type='button'
              className='hidden font-mono text-[11px] text-muted-foreground [writing-mode:vertical-rl] md:block'
              onClick={() => togglePanel('palette')}
            >
              palette
            </button>
          )}
        </aside>
        <main className='relative min-h-[420px]'>
          <ArchitectureCanvas
            doc={session.doc}
            canvas={session.canvas}
            catalog={catalog.data}
            readOnly={readOnly}
            canComment={canComment}
            selection={selection}
            onSelect={select}
            peers={session.peers}
            onPointer={(point) => {
              // Others see the pointer move; at most one update every 50 ms.
              const now = performance.now()
              if (point && now - lastPointerShare.current < 50) return
              lastPointerShare.current = now
              session.share('pointer', point)
            }}
            onConnected={(id, screen) => setProtocolFor({ id, ...screen })}
            onAdd={(item, point) => add(item, point)}
            onDelete={remove}
            onComment={(anchor) => {
              setActiveThread(null)
              setDraftPin(anchor)
            }}
            onUndo={() => undo?.undo()}
            onRedo={() => undo?.redo()}
            onGesture={gesture}
            canAdd={!blocked}
            focusNodeID={focusNodeID}
          >
            <CommentPins
              workspaceID={workspaceID}
              documentID={doc.id}
              userID={userID}
              canvas={session.canvas}
              canComment={canComment}
              showResolved={showResolved}
              draft={draftPin}
              onDraftDone={(threadID) => {
                setDraftPin(null)
                if (threadID) setActiveThread(threadID)
              }}
              active={activeThread}
              onActive={setActiveThread}
              onChanged={() => session.signalComments()}
            />
          </ArchitectureCanvas>
          {protocolConnection && !readOnly && (
            <div
              role='dialog'
              aria-label='Choose the protocol'
              className='fixed z-50 flex w-64 flex-col gap-2 rounded-[6px] border border-border bg-card p-2 shadow-md'
              style={{
                left: Math.min(protocolFor!.x, window.innerWidth - 272),
                top: Math.min(protocolFor!.y + 8, window.innerHeight - 200),
              }}
              onKeyDown={(event) =>
                event.key === 'Escape' && setProtocolFor(null)
              }
            >
              <span className='font-mono text-[11px] text-muted-foreground'>
                protocol · suggested
                {targetSubkind ? ` for ${targetSubkind}` : ''}
              </span>
              <div className='flex flex-wrap gap-1'>
                {suggestedProtocols(targetSubkind).map((p, index) => (
                  <Button
                    key={p}
                    size='sm'
                    autoFocus={index === 0}
                    variant={
                      protocolConnection.protocol === p ? 'default' : 'outline'
                    }
                    className='h-7 font-mono text-[11px]'
                    onClick={() => {
                      if (session.doc)
                        updateConnection(session.doc, protocolConnection.id, {
                          protocol: p,
                        })
                      setProtocolFor(null)
                    }}
                  >
                    {p}
                  </Button>
                ))}
              </div>
              <label
                htmlFor='architecture-protocol-other'
                className='font-mono text-[11px] text-muted-foreground'
              >
                other
              </label>
              <select
                id='architecture-protocol-other'
                className='h-8 rounded-[4px] border border-input bg-card px-2 text-[12.5px]'
                value=''
                onChange={(event) => {
                  if (session.doc && event.target.value)
                    updateConnection(session.doc, protocolConnection.id, {
                      protocol: event.target.value,
                    })
                  setProtocolFor(null)
                }}
              >
                <option value=''>Choose another protocol…</option>
                {protocolFamilies(catalog.data ?? []).map((group) => (
                  <optgroup key={group.family} label={group.family}>
                    {group.entries.map((e) => (
                      <option key={e.slug} value={e.slug}>
                        {e.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <Button
                size='sm'
                variant='ghost'
                className='self-end'
                onClick={() => setProtocolFor(null)}
              >
                Done
              </Button>
            </div>
          )}
        </main>
        <aside
          aria-label='Properties'
          className='flex flex-col gap-2 border-t border-border bg-background p-3 md:min-h-0 md:overflow-y-auto md:border-t-0 md:border-l'
        >
          <div className='flex items-center justify-between'>
            <Button
              size='icon'
              variant='ghost'
              className='size-8'
              aria-expanded={propsOpen}
              aria-controls='architecture-properties'
              aria-label={
                propsOpen
                  ? 'Collapse the properties panel'
                  : 'Expand the properties panel'
              }
              onClick={() => togglePanel('props')}
            >
              <PanelRight className='size-4' strokeWidth={1.5} />
            </Button>
            {propsOpen && (
              <span className='font-mono text-[11px] text-muted-foreground'>
                properties
              </span>
            )}
          </div>
          {propsOpen ? (
            <div id='architecture-properties'>
              <PropertiesPanel
                doc={session.doc}
                canvas={session.canvas}
                catalog={catalog.data ?? []}
                selection={selection}
                canEdit={canEdit}
                workspaceID={workspaceID}
                projectID={doc.projectId ?? null}
                onDelete={remove}
                onGesture={gesture}
                documentID={doc.id}
                canComment={canComment}
                onCommentsChanged={() => session.signalComments()}
                userID={userID}
                onOpenThread={setActiveThread}
                showResolved={showResolved}
                onShowResolved={setShowResolved}
              />
            </div>
          ) : (
            <button
              type='button'
              className='hidden font-mono text-[11px] text-muted-foreground [writing-mode:vertical-rl] md:block'
              onClick={() => togglePanel('props')}
            >
              properties
            </button>
          )}
        </aside>
      </div>

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingDelete?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              Their Connections go too. Linked documents stay in the project;
              only the links are removed. You can undo this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-white hover:bg-destructive/90'
              onClick={() => {
                if (pendingDelete) commitRemove(pendingDelete.elements)
                setPendingDelete(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <VersionHistorySidebar
        docId={doc.id}
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        revisions={revisionsQuery.data ?? []}
        canEdit={canEdit}
        isLoading={isHistoryOpen && revisionsQuery.isPending}
        loadError={
          revisionsQuery.error instanceof Error
            ? revisionsQuery.error.message
            : ''
        }
        isSaving={createRevision.isPending}
        isRestoring={restore.isPending}
        onCreateSnapshot={(title) => createRevision.mutateAsync(title)}
        onRestoreRevision={restoreRevision}
        renderPreview={(revision) => (
          <ArchitecturePreview
            canvas={parseCanvas(revision.contentJSON)}
            className='max-h-64 rounded-[6px] border border-border bg-background'
            label={`Canvas at version ${revision.versionNumber}`}
          />
        )}
      />
      <PublicShareDialog
        open={isShareOpen}
        onOpenChange={setIsShareOpen}
        workspaceID={workspaceID}
        documentID={doc.id}
      />
      <ArchitectureVersions
        open={isVersionsOpen}
        onOpenChange={setIsVersionsOpen}
        workspaceID={workspaceID}
        document={doc}
        canEdit={canEdit}
        currentCanvas={session.canvas}
        onRestored={async () => {
          await clearLocalCopy(workspaceID, doc.id)
          setNonce((n) => n + 1)
        }}
      />
    </div>
  )
}
