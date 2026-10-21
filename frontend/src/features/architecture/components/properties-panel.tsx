import { useMemo, useState } from 'react'
import type * as Y from 'yjs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { resizeElement, toLayoutNodes } from '../lib/canvas-actions'
import { updateConnection, updateNode } from '../lib/canvas-doc'
import type { ArchitectureJSON, ArchitectureNode } from '../lib/canvas-model'
import type { Selected } from '../lib/canvas-selection'
import {
  HOST_SUBKINDS,
  protocolFamilies,
  SYSTEM_SUBKINDS,
  type CatalogEntry,
} from '../lib/catalog'
import { minSize } from '../lib/layout'
import type { Selection } from './architecture-canvas'
import { CatalogIcon } from './catalog-icon'
import { InlineField } from './inline-field'
import { SystemConnections } from './system-connections'

const fieldLabel = 'font-mono text-[11px] text-muted-foreground'
const selectClass =
  'h-8 w-full rounded-[4px] border border-input bg-card px-2 text-[12.5px] focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-60'

function Field({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='flex flex-col gap-1'>
      <label id={`${id}-label`} htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      {children}
    </div>
  )
}

function CatalogSelect({
  id,
  value,
  entries,
  category,
  disabled,
  onChange,
  emptyLabel,
}: {
  id: string
  value: string | null
  entries: CatalogEntry[]
  category: 'host' | 'system'
  disabled: boolean
  onChange: (slug: string | null) => void
  emptyLabel?: string
}) {
  const order = category === 'host' ? HOST_SUBKINDS : SYSTEM_SUBKINDS
  const known = entries.some((e) => e.slug === value)
  return (
    <select
      id={id}
      className={selectClass}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    >
      {emptyLabel && <option value=''>{emptyLabel}</option>}
      {value && !known && <option value={value}>{value}</option>}
      {order.map((subkind) => (
        <optgroup key={subkind} label={subkind}>
          {entries
            .filter(
              (e) =>
                e.category === category &&
                e.subkind === subkind &&
                (!e.deprecated || e.slug === value)
            )
            .map((e) => (
              <option key={e.slug} value={e.slug}>
                {e.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  )
}

export type PropertiesPanelProps = {
  doc: Y.Doc | null
  canvas: ArchitectureJSON
  catalog: CatalogEntry[]
  selection: Selection
  canEdit: boolean
  onDelete: (elements: Selected[]) => void
  /** Selects other elements, to walk from a System to the ones it connects to. */
  onSelect: (selection: Selection) => void
  onGesture: () => void
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  const { canvas, selection } = props
  const byID = useMemo(
    () => new Map(canvas.nodes.map((n) => [n.id, n])),
    [canvas]
  )
  if (!selection.length) {
    return (
      <p className='text-xs text-muted-foreground'>
        Select a Host, System or Connection.
      </p>
    )
  }
  if (selection.length > 1) {
    const count = `${selection.length} elements`
    return (
      <div className='flex flex-col gap-2.5'>
        <p className='text-[13px] font-medium'>{count} selected</p>
        {props.canEdit && (
          <Button
            size='sm'
            variant='outline'
            className='self-start text-destructive hover:border-destructive'
            onClick={() => props.onDelete(selection)}
          >
            Delete {count}
          </Button>
        )}
      </div>
    )
  }
  const only = selection[0]!
  if (only.kind === 'edge') {
    const connection = canvas.connections.find((c) => c.id === only.id)
    if (!connection) return null
    return (
      <ConnectionProperties
        {...props}
        connectionID={connection.id}
        names={[
          byID.get(connection.source)?.name ?? '',
          byID.get(connection.target)?.name ?? '',
        ]}
      />
    )
  }
  const node = byID.get(only.id)
  if (!node) return null
  return node.kind === 'system' ? (
    <SystemProperties {...props} node={node} byID={byID} />
  ) : (
    <ContainerProperties {...props} node={node} />
  )
}

function runsOn(node: ArchitectureNode, byID: Map<string, ArchitectureNode>) {
  let parent = node.parentId ? byID.get(node.parentId) : undefined
  let group: ArchitectureNode | undefined
  while (parent && parent.kind !== 'host') {
    group ??= parent
    parent = parent.parentId ? byID.get(parent.parentId) : undefined
  }
  return { host: parent, group }
}

function SystemProperties({
  node,
  byID,
  ...props
}: PropertiesPanelProps & {
  node: ArchitectureNode
  byID: Map<string, ArchitectureNode>
}) {
  const { doc, canEdit, catalog } = props
  const entry = catalog.find((e) => e.slug === node.catalog)
  const { host, group } = runsOn(node, byID)
  const set = (fields: Parameters<typeof updateNode>[2]) =>
    doc && updateNode(doc, node.id, fields)
  return (
    <div className='flex flex-col gap-2.5'>
      <div className='flex items-center gap-2'>
        <CatalogIcon
          slug={node.catalog}
          subkind={entry?.subkind ?? 'job'}
          size={24}
        />
        <div className='min-w-0'>
          <p className='font-mono text-[11px] text-muted-foreground'>system</p>
          <h2 className='truncate text-sm font-semibold'>
            {node.name || 'Untitled'}
          </h2>
        </div>
      </div>
      <Field id='architecture-name' label='name'>
        <InlineField
          id='architecture-name'
          value={node.name}
          canEdit={canEdit}
          placeholder='Untitled'
          onChange={(name) => set({ name })}
        />
      </Field>
      <Field id='architecture-type' label='type'>
        <CatalogSelect
          id='architecture-type'
          value={node.catalog}
          entries={catalog}
          category='system'
          disabled={!canEdit}
          onChange={(slug) => set({ catalog: slug })}
        />
      </Field>
      <Field id='architecture-tag-add' label='tags'>
        <div className='flex flex-wrap gap-1'>
          {node.tags.map((tag) => (
            <span
              key={tag}
              className='inline-flex items-center gap-1 rounded-[4px] border border-border py-0.5 pr-1 pl-0.5 text-xs'
            >
              <CatalogIcon slug={tag} size={16} />
              {catalog.find((e) => e.slug === tag)?.name ?? tag}
              {canEdit && (
                <button
                  type='button'
                  className='px-0.5 text-muted-foreground hover:text-foreground'
                  aria-label={`Remove tag ${tag}`}
                  onClick={() =>
                    set({ tags: node.tags.filter((t) => t !== tag) })
                  }
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        {canEdit && (
          <CatalogSelect
            id='architecture-tag-add'
            value={null}
            entries={catalog.filter(
              (e) => !node.tags.includes(e.slug) && e.slug !== node.catalog
            )}
            category='system'
            disabled={!canEdit}
            emptyLabel='Add a tag…'
            onChange={(slug) => slug && set({ tags: [...node.tags, slug] })}
          />
        )}
      </Field>
      <div className='flex items-baseline justify-between gap-2 text-[12.5px]'>
        <span className={fieldLabel}>runs on</span>
        <span className='truncate'>
          {host ? host.name : 'none'}
          {group && (
            <span className='text-muted-foreground'> · {group.name}</span>
          )}
        </span>
      </div>
      <Field id='architecture-description' label='description'>
        <InlineField
          id='architecture-description'
          value={node.description}
          canEdit={canEdit}
          multiline
          placeholder='Add a description'
          onChange={(description) => set({ description })}
        />
      </Field>
      <Field id='architecture-repo' label='repository URL'>
        <InlineField
          id='architecture-repo'
          type='url'
          value={node.repoUrl ?? ''}
          canEdit={canEdit}
          placeholder='https://'
          onChange={(repoUrl) => set({ repoUrl: repoUrl || null })}
        />
      </Field>
      <SystemConnections
        canvas={props.canvas}
        systemID={node.id}
        onSelect={props.onSelect}
      />
      {canEdit && <DeleteButton {...props} node={node} />}
    </div>
  )
}

function ConnectionProperties({
  connectionID,
  names,
  ...props
}: PropertiesPanelProps & { connectionID: string; names: [string, string] }) {
  const { doc, canEdit, canvas, catalog } = props
  const connection = canvas.connections.find((c) => c.id === connectionID)!
  const set = (fields: Parameters<typeof updateConnection>[2]) =>
    doc && updateConnection(doc, connection.id, fields)
  return (
    <div className='flex flex-col gap-2.5'>
      <div>
        <p className='font-mono text-[11px] text-muted-foreground'>
          connection
        </p>
        <h2 className='text-sm font-semibold'>
          {names[0] || 'Untitled'} → {names[1] || 'Untitled'}
        </h2>
      </div>
      <Field id='architecture-protocol' label='protocol'>
        <select
          id='architecture-protocol'
          className={selectClass}
          value={connection.protocol}
          disabled={!canEdit}
          onChange={(e) => set({ protocol: e.target.value })}
        >
          {protocolFamilies(catalog).map((group) => (
            <optgroup key={group.family} label={group.family}>
              {group.entries.map((e) => (
                <option key={e.slug} value={e.slug}>
                  {e.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field id='architecture-label' label='label'>
        <Input
          id='architecture-label'
          value={connection.label}
          disabled={!canEdit}
          placeholder='order.created, /api/orders'
          onChange={(e) => set({ label: e.target.value })}
          className='h-8 text-[12.5px]'
        />
      </Field>
      <Field id='architecture-port' label='port (optional)'>
        <Input
          id='architecture-port'
          value={connection.port ?? ''}
          disabled={!canEdit}
          onChange={(e) => set({ port: e.target.value || null })}
          className='h-8 text-[12.5px]'
        />
      </Field>
      {canEdit && (
        <Button
          size='sm'
          variant='outline'
          className='self-start text-destructive hover:border-destructive'
          onClick={() => props.onDelete([{ kind: 'edge', id: connection.id }])}
        >
          Delete connection
        </Button>
      )}
    </div>
  )
}

function ContainerProperties({
  node,
  ...props
}: PropertiesPanelProps & { node: ArchitectureNode }) {
  const { doc, canEdit, canvas, catalog } = props
  const layout = toLayoutNodes(canvas)
  const min = minSize(layout, node.id)
  const entry = catalog.find((e) => e.slug === node.catalog)
  // The floor is explained only when a typed size was held to it.
  const [refused, setRefused] = useState(false)
  const resize = (w: number, h: number) => {
    setRefused(w < min.w || h < min.h)
    if (doc)
      resizeElement(doc, canvas, node.id, {
        x: node.x,
        y: node.y,
        w: Math.max(min.w, w || 0),
        h: Math.max(min.h, h || 0),
      })
  }
  return (
    <div className='flex flex-col gap-2.5'>
      <div className='flex items-center gap-2'>
        {node.kind === 'host' && (
          <CatalogIcon
            slug={node.catalog}
            subkind={entry?.subkind ?? 'compute'}
            size={24}
          />
        )}
        <div className='min-w-0'>
          <p className='font-mono text-[11px] text-muted-foreground'>
            {node.kind}
          </p>
          <h2 className='truncate text-sm font-semibold'>
            {node.name || (node.kind === 'group' ? 'Group' : 'Host')}
          </h2>
        </div>
      </div>
      <Field id='architecture-name' label='name'>
        <Input
          id='architecture-name'
          value={node.name}
          disabled={!canEdit}
          onChange={(e) =>
            doc && updateNode(doc, node.id, { name: e.target.value })
          }
          className='h-8 text-[12.5px]'
        />
      </Field>
      {node.kind === 'host' && (
        <Field id='architecture-type' label='type'>
          <CatalogSelect
            id='architecture-type'
            value={node.catalog}
            entries={catalog}
            category='host'
            disabled={!canEdit}
            onChange={(slug) =>
              doc && updateNode(doc, node.id, { catalog: slug })
            }
          />
        </Field>
      )}
      <div className='flex flex-col gap-1'>
        <span className={fieldLabel}>size</span>
        <div className='flex items-center gap-2'>
          <label htmlFor='architecture-width' className='sr-only'>
            Width
          </label>
          <Input
            id='architecture-width'
            type='number'
            step={8}
            min={min.w}
            value={node.w ?? 0}
            disabled={!canEdit}
            onChange={(e) => resize(Number(e.target.value), node.h ?? 0)}
            className='h-8 w-20 font-mono text-[12px] tabular-nums'
          />
          <span aria-hidden className='text-muted-foreground'>
            ×
          </span>
          <label htmlFor='architecture-height' className='sr-only'>
            Height
          </label>
          <Input
            id='architecture-height'
            type='number'
            step={8}
            min={min.h}
            value={node.h ?? 0}
            disabled={!canEdit}
            onChange={(e) => resize(node.w ?? 0, Number(e.target.value))}
            className='h-8 w-20 font-mono text-[12px] tabular-nums'
          />
        </div>
        {refused && (
          <span role='status' className='text-xs text-muted-foreground'>
            Not smaller than {min.w} × {min.h}: what is inside needs that much.
          </span>
        )}
      </div>
      {canEdit && <DeleteButton {...props} node={node} />}
    </div>
  )
}

function DeleteButton({
  node,
  onDelete,
}: PropertiesPanelProps & { node: ArchitectureNode }) {
  return (
    <Button
      size='sm'
      variant='outline'
      className='self-start text-destructive hover:border-destructive'
      onClick={() => onDelete([{ kind: 'node', id: node.id }])}
    >
      Delete {node.kind}
    </Button>
  )
}
