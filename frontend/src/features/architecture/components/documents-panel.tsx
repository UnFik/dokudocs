import type * as Y from 'yjs'
import { updateConnection, updateNode } from '../lib/canvas-doc'
import { linkedElement } from '../lib/canvas-links'
import type { ArchitectureJSON } from '../lib/canvas-model'
import type { Selection } from './architecture-canvas'
import { DocumentLinks } from './document-links'

/** The Documents tab: the documents the selected System or Connection links to. */
export function DocumentsPanel({
  doc,
  canvas,
  selection,
  canEdit,
  workspaceID,
  projectID,
}: {
  doc: Y.Doc | null
  canvas: ArchitectureJSON
  selection: Selection
  canEdit: boolean
  workspaceID: string
  projectID: string | null
}) {
  const element = linkedElement(canvas, selection)
  if (!element) {
    return (
      <p className='text-xs text-muted-foreground'>
        Select a System or Connection to see the documents it links to.
      </p>
    )
  }
  const set = (links: string[]) =>
    doc &&
    (element.kind === 'system'
      ? updateNode(doc, element.id, { links })
      : updateConnection(doc, element.id, { links }))
  return (
    <div className='flex flex-col gap-2.5'>
      <div className='min-w-0'>
        <p className='font-mono text-[11px] text-muted-foreground'>
          {element.kind}
        </p>
        <h2 className='truncate text-sm font-semibold'>{element.title}</h2>
      </div>
      <DocumentLinks
        workspaceID={workspaceID}
        projectID={projectID}
        links={element.links}
        canEdit={canEdit}
        onChange={set}
      />
    </div>
  )
}
