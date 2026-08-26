import mermaid from 'mermaid'
import { DocType } from '@/types/dokudocs'

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function stripDbmlComments(rawContent: string): string {
  const withoutBlock = rawContent.replace(/\/\*[\s\S]*?\*\//g, '')
  return withoutBlock
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//')
      if (idx !== -1) {
        return line.substring(0, idx)
      }
      return line
    })
    .join('\n')
}

interface TableColumn {
  name: string
  type: string
  isPk: boolean
  isFk: boolean
  isUnique: boolean
}

interface ParsedTable {
  name: string
  alias?: string
  headerColor?: string
  columns: TableColumn[]
}

interface ParsedTableGroup {
  name: string
  color?: string
  tables: string[]
}

interface ParsedRelation {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
  relType: string
}

const TABLE_WIDTH = 250
const HEADER_HEIGHT = 38
const ROW_HEIGHT = 24
const MAX_THUMBNAIL_COLUMNS = 5
const MAX_THUMBNAIL_TABLES = 6
const MAX_THUMBNAIL_FLOWCHART_NODES = 8
const MAX_THUMBNAIL_PARTICIPANTS = 4
const MAX_THUMBNAIL_MESSAGES = 6

function calculateTableHeight(table: ParsedTable, maxCols = MAX_THUMBNAIL_COLUMNS): number {
  const count = Math.min(table.columns.length, maxCols)
  const hasMore = table.columns.length > maxCols
  return HEADER_HEIGHT + count * ROW_HEIGHT + (hasMore ? 22 : 0) + 6
}

function resolveColor(color?: string, fallback = '#10b981'): string {
  if (!color) return fallback
  const c = color.trim()
  if (c.startsWith('#') || c.startsWith('rgb')) return c
  const named: Record<string, string> = {
    blue: '#3b82f6',
    emerald: '#10b981',
    green: '#22c55e',
    purple: '#a855f7',
    violet: '#8b5cf6',
    pink: '#ec4899',
    amber: '#f59e0b',
    orange: '#f97316',
    red: '#ef4444',
    teal: '#14b8a6',
    cyan: '#06b6d4',
    indigo: '#6366f1',
    rose: '#f43f5e',
    slate: '#64748b',
    gray: '#6b7280',
  }
  return named[c.toLowerCase()] || fallback
}

export function generateDbmlThumbnail(
  content: string,
  docId?: string,
  isDark = false
): string {
  const cleanContent = stripDbmlComments(content)
  if (!cleanContent.trim()) return ''

  const allRelations: ParsedRelation[] = []
  const relRegex =
    /Ref(?:\s+[\w.-]+)?\s*:\s*([\w."]+)\.([\w."]+)\s*([><-][?]|\?[><-]|<>|[><-])\s*([\w."]+)\.([\w."]+)/gi
  let relMatch: RegExpExecArray | null
  while ((relMatch = relRegex.exec(cleanContent)) !== null) {
    allRelations.push({
      fromTable: relMatch[1].replace(/["']/g, '').trim(),
      fromColumn: relMatch[2].replace(/["']/g, '').trim(),
      toTable: relMatch[4].replace(/["']/g, '').trim(),
      toColumn: relMatch[5].replace(/["']/g, '').trim(),
      relType: relMatch[3].trim(),
    })
  }

  const tableGroups: ParsedTableGroup[] = []
  const groupRegex =
    /TableGroup\s+(\w+)(?:\s+as\s+(\w+))?\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/gi
  let groupMatch: RegExpExecArray | null
  while ((groupMatch = groupRegex.exec(cleanContent)) !== null) {
    const groupName = groupMatch[1]
    const groupOpts = groupMatch[3] || ''
    const groupBody = groupMatch[4]
    const groupTables = groupBody
      .split('\n')
      .map((l) => l.trim().replace(/["']/g, ''))
      .filter((l) => l && !l.startsWith('//'))

    let groupColor: string | undefined = undefined
    const colorMatch = groupOpts.match(
      /(?:headercolor|color|fill)\s*:\s*['"]?([#\w]+)['"]?/i
    )
    if (colorMatch) {
      groupColor = colorMatch[1]
    }

    tableGroups.push({
      name: groupName,
      color: groupColor,
      tables: groupTables,
    })
  }

  const allTables: ParsedTable[] = []
  const tableRegex =
    /Table\s+([\w."]+)(?:\s+as\s+([\w."]+))?\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/gi
  let match: RegExpExecArray | null
  while ((match = tableRegex.exec(cleanContent)) !== null) {
    const tableName = match[1].replace(/["']/g, '').trim()
    const alias = match[2]?.replace(/["']/g, '').trim()
    const tableOpts = match[3] || ''
    const body = match[4]

    let headerColor: string | undefined = undefined
    const colorMatch = tableOpts.match(
      /(?:headercolor|color|fill)\s*:\s*['"]?([#\w]+)['"]?/i
    )
    if (colorMatch) {
      headerColor = colorMatch[1]
    }

    const columns: TableColumn[] = []
    const lines = body.split('\n')
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || line.startsWith('//') || line.startsWith('indexes') || line.startsWith('Note:')) continue

      const colMatch = line.match(/^([\w."]+)\s+([\w()]+)(?:\s*\[([^\]]*)\])?/)
      if (colMatch) {
        const colName = colMatch[1].replace(/["']/g, '').trim()
        const colType = colMatch[2]
        const colOpts = colMatch[3] || ''

        const isPk =
          colOpts.toLowerCase().includes('pk') ||
          colOpts.toLowerCase().includes('primary key')
        const isUnique = colOpts.toLowerCase().includes('unique')

        const inlineRefMatch = colOpts.match(
          /ref:\s*([><-][?]|\?[><-]|<>|[><-])\s*([\w."]+)\.([\w."]+)/i
        )
        if (inlineRefMatch) {
          allRelations.push({
            fromTable: tableName,
            fromColumn: colName,
            toTable: inlineRefMatch[2].replace(/["']/g, '').trim(),
            toColumn: inlineRefMatch[3].replace(/["']/g, '').trim(),
            relType: inlineRefMatch[1].trim(),
          })
        }

        const isFk =
          Boolean(inlineRefMatch) ||
          allRelations.some(
            (r) =>
              r.fromTable.toLowerCase() === tableName.toLowerCase() &&
              r.fromColumn.toLowerCase() === colName.toLowerCase()
          )

        columns.push({
          name: colName,
          type: colType,
          isPk,
          isFk,
          isUnique,
        })
      }
    }

    if (columns.length > 0) {
      allTables.push({
        name: tableName,
        alias,
        headerColor,
        columns,
      })
    }
  }

  if (allTables.length === 0) return ''

  let tables = allTables
  if (allTables.length > MAX_THUMBNAIL_TABLES) {
    const connectivity = new Map<string, number>()
    allTables.forEach((t) => connectivity.set(t.name.toLowerCase(), 0))

    allRelations.forEach((rel) => {
      const from = rel.fromTable.toLowerCase()
      const to = rel.toTable.toLowerCase()
      connectivity.set(from, (connectivity.get(from) || 0) + 2)
      connectivity.set(to, (connectivity.get(to) || 0) + 2)
    })

    allTables.forEach((t) => {
      let score = connectivity.get(t.name.toLowerCase()) || 0
      if (t.columns.some((c) => c.isPk)) score += 3
      if (t.headerColor) score += 2
      connectivity.set(t.name.toLowerCase(), score)
    })

    const sorted = [...allTables].sort((a, b) => {
      const scoreA = connectivity.get(a.name.toLowerCase()) || 0
      const scoreB = connectivity.get(b.name.toLowerCase()) || 0
      return scoreB - scoreA
    })

    tables = sorted.slice(0, MAX_THUMBNAIL_TABLES)
  }

  const sampledTableNames = new Set(tables.map((t) => t.name.toLowerCase()))

  const relations = allRelations.filter(
    (rel) =>
      sampledTableNames.has(rel.fromTable.toLowerCase()) &&
      sampledTableNames.has(rel.toTable.toLowerCase())
  )

  const nextPositions: Record<string, { x: number; y: number }> = {}
  const cols = tables.length === 1 ? 1 : tables.length <= 4 ? 2 : 3
  const gridSpacingX = TABLE_WIDTH + 60
  const gridSpacingY = 220

  tables.forEach((tbl, idx) => {
    const row = Math.floor(idx / cols)
    const col = idx % cols
    nextPositions[tbl.name] = {
      x: 40 + col * gridSpacingX,
      y: 40 + row * gridSpacingY,
    }
  })

  let minBoundX = Infinity
  let minBoundY = Infinity
  let maxBoundX = -Infinity
  let maxBoundY = -Infinity

  tables.forEach((tbl) => {
    const pos = nextPositions[tbl.name]
    if (!pos) return
    const height = calculateTableHeight(tbl)
    minBoundX = Math.min(minBoundX, pos.x)
    minBoundY = Math.min(minBoundY, pos.y)
    maxBoundX = Math.max(maxBoundX, pos.x + TABLE_WIDTH)
    maxBoundY = Math.max(maxBoundY, pos.y + height)
  })

  const renderedGroups = tableGroups
    .map((grp) => {
      const memberTables = tables.filter((t) =>
        grp.tables.some((gt) => gt.toLowerCase() === t.name.toLowerCase())
      )
      if (memberTables.length === 0) return null

      let gxMin = Infinity
      let gyMin = Infinity
      let gxMax = -Infinity
      let gyMax = -Infinity

      memberTables.forEach((t) => {
        const pos = nextPositions[t.name]
        if (!pos) return
        const height = calculateTableHeight(t)
        gxMin = Math.min(gxMin, pos.x)
        gyMin = Math.min(gyMin, pos.y)
        gxMax = Math.max(gxMax, pos.x + TABLE_WIDTH)
        gyMax = Math.max(gyMax, pos.y + height)
      })

      if (gxMin === Infinity) return null

      const pad = 16
      const x = gxMin - pad
      const y = gyMin - pad - 14
      const width = gxMax - gxMin + pad * 2
      const height = gyMax - gyMin + pad * 2 + 14
      const color = resolveColor(grp.color, '#8b5cf6')

      minBoundX = Math.min(minBoundX, x)
      minBoundY = Math.min(minBoundY, y)
      maxBoundX = Math.max(maxBoundX, x + width)
      maxBoundY = Math.max(maxBoundY, y + height)

      return {
        name: grp.name,
        color,
        x,
        y,
        width,
        height,
      }
    })
    .filter(Boolean)

  if (minBoundX === Infinity) {
    minBoundX = 0
    minBoundY = 0
    maxBoundX = 400
    maxBoundY = 300
  }

  const padding = 32
  const totalViewWidth = maxBoundX - minBoundX + padding * 2
  const totalViewHeight = maxBoundY - minBoundY + padding * 2
  const startViewX = minBoundX - padding
  const startViewY = minBoundY - padding

  const cardBg = isDark ? '#09090b' : '#ffffff'
  const tableBg = isDark ? '#18181b' : '#ffffff'
  const textColor = isDark ? '#f4f4f5' : '#09090b'
  const mutedColor = isDark ? '#a1a1aa' : '#64748b'
  const gridDotColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
  const dividerColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
  const relStroke = isDark ? '#34d399' : '#10b981'

  const svgElements: string[] = [
    `<defs>
      <pattern id="dbGrid_${docId || 'def'}_${isDark ? 'dark' : 'light'}" width="24" height="24" patternUnits="userSpaceOnUse">
        <circle cx="12" cy="12" r="1.2" fill="${gridDotColor}" />
      </pattern>
    </defs>`,
    `<rect x="${startViewX}" y="${startViewY}" width="${totalViewWidth}" height="${totalViewHeight}" fill="${cardBg}" />`,
    `<rect x="${startViewX}" y="${startViewY}" width="${totalViewWidth}" height="${totalViewHeight}" fill="url(#dbGrid_${docId || 'def'}_${isDark ? 'dark' : 'light'})" />`,
  ]

  renderedGroups.forEach((g) => {
    if (!g) return
    svgElements.push(`
      <g>
        <rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="10" fill="${g.color}" fill-opacity="${isDark ? '0.12' : '0.05'}" stroke="${g.color}" stroke-width="1.5" stroke-dasharray="5,5" stroke-opacity="0.6" />
        <rect x="${g.x + 10}" y="${g.y}" width="${g.name.length * 8 + 20}" height="20" rx="5" fill="${g.color}" fill-opacity="${isDark ? '0.35' : '0.2'}" />
        <text x="${g.x + 20}" y="${g.y + 14}" font-size="11" font-weight="700" font-family="system-ui, sans-serif" fill="${g.color}">${escapeXml(g.name)}</text>
      </g>
    `)
  })

  relations.forEach((rel) => {
    const fromTable = tables.find(
      (t) => t.name.toLowerCase() === rel.fromTable.toLowerCase()
    )
    const toTable = tables.find(
      (t) => t.name.toLowerCase() === rel.toTable.toLowerCase()
    )
    if (!fromTable || !toTable) return

    const fromPos = nextPositions[fromTable.name]
    const toPos = nextPositions[toTable.name]
    if (!fromPos || !toPos) return

    const fromColIdx = fromTable.columns.findIndex(
      (c) => c.name.toLowerCase() === rel.fromColumn.toLowerCase()
    )
    const toColIdx = toTable.columns.findIndex(
      (c) => c.name.toLowerCase() === rel.toColumn.toLowerCase()
    )

    const fromColDisplay = Math.min(fromColIdx >= 0 ? fromColIdx : 0, MAX_THUMBNAIL_COLUMNS - 1)
    const toColDisplay = Math.min(toColIdx >= 0 ? toColIdx : 0, MAX_THUMBNAIL_COLUMNS - 1)

    const fromY =
      fromPos.y + HEADER_HEIGHT + fromColDisplay * ROW_HEIGHT + ROW_HEIGHT / 2
    const toY =
      toPos.y + HEADER_HEIGHT + toColDisplay * ROW_HEIGHT + ROW_HEIGHT / 2

    const fromIsLeft = fromPos.x < toPos.x
    let startX = fromIsLeft ? fromPos.x + TABLE_WIDTH : fromPos.x
    let endX = fromIsLeft ? toPos.x : toPos.x + TABLE_WIDTH
    let midX = (startX + endX) / 2

    if (fromPos.x === toPos.x) {
      startX = fromPos.x + TABLE_WIDTH
      endX = toPos.x + TABLE_WIDTH
      midX = startX + 35
    }

    svgElements.push(`
      <path d="M ${startX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${endX} ${toY}" stroke="${relStroke}" stroke-width="1.8" fill="none" stroke-opacity="0.65" />
      <circle cx="${startX}" cy="${fromY}" r="2.8" fill="${relStroke}" />
      <circle cx="${endX}" cy="${toY}" r="2.8" fill="${relStroke}" />
    `)
  })

  tables.forEach((tbl) => {
    const pos = nextPositions[tbl.name] || { x: 40, y: 40 }
    const tHeight = calculateTableHeight(tbl)
    const headerColor = resolveColor(tbl.headerColor, '#10b981')
    const visibleColumns = tbl.columns.slice(0, MAX_THUMBNAIL_COLUMNS)
    const extraCount = tbl.columns.length - MAX_THUMBNAIL_COLUMNS

    const displayTableName =
      tbl.name.length > 18 ? tbl.name.slice(0, 17) + '…' : tbl.name

    svgElements.push(`
      <g transform="translate(${pos.x}, ${pos.y})">
        <rect width="${TABLE_WIDTH}" height="${tHeight}" rx="10" fill="${tableBg}" stroke="${headerColor}" stroke-width="1.5" stroke-opacity="0.45" />
        <rect width="${TABLE_WIDTH}" height="${HEADER_HEIGHT}" rx="9" fill="${headerColor}" fill-opacity="${isDark ? '0.25' : '0.15'}" />
        <line x1="0" y1="${HEADER_HEIGHT}" x2="${TABLE_WIDTH}" y2="${HEADER_HEIGHT}" stroke="${headerColor}" stroke-width="1.2" stroke-opacity="0.35" />
        <text x="12" y="24" font-size="12" font-weight="700" font-family="system-ui, -apple-system, sans-serif" fill="${headerColor}">${escapeXml(displayTableName)}</text>
        ${
          tbl.alias
            ? `<text x="${TABLE_WIDTH - 12}" y="23" text-anchor="end" font-size="9" font-family="ui-monospace, monospace" fill="${mutedColor}">${escapeXml(tbl.alias)}</text>`
            : `<text x="${TABLE_WIDTH - 12}" y="23" text-anchor="end" font-size="8.5" font-family="ui-monospace, monospace" fill="${mutedColor}">${tbl.columns.length} cols</text>`
        }
        ${visibleColumns
          .map((col, idx) => {
            const colY = HEADER_HEIGHT + idx * ROW_HEIGHT
            const maxNameLen = col.isPk || col.isFk ? 13 : 16
            const colDisplayName =
              col.name.length > maxNameLen
                ? col.name.slice(0, maxNameLen - 1) + '…'
                : col.name
            const colDisplayType =
              col.type.length > 10 ? col.type.slice(0, 9) + '…' : col.type

            return `
              <g transform="translate(0, ${colY})">
                <line x1="0" y1="${ROW_HEIGHT}" x2="${TABLE_WIDTH}" y2="${ROW_HEIGHT}" stroke="${dividerColor}" />
                <text x="12" y="16.5" font-size="10.5" font-family="ui-monospace, monospace" font-weight="${col.isPk ? '600' : '400'}" fill="${textColor}" fill-opacity="${col.isPk ? '1' : '0.85'}">${escapeXml(colDisplayName)}</text>
                <text x="${TABLE_WIDTH - (col.isPk || col.isFk ? 38 : 12)}" y="16.5" text-anchor="end" font-size="8.5" font-family="ui-monospace, monospace" fill="${mutedColor}">${escapeXml(colDisplayType)}</text>
                ${col.isPk ? `<rect x="${TABLE_WIDTH - 32}" y="5.5" width="20" height="13" rx="2.5" fill="#eab308" fill-opacity="0.22" /><text x="${TABLE_WIDTH - 22}" y="15" font-size="7.5" font-weight="bold" font-family="system-ui, sans-serif" fill="#ca8a04" text-anchor="middle">PK</text>` : ''}
                ${col.isFk && !col.isPk ? `<rect x="${TABLE_WIDTH - 32}" y="5.5" width="20" height="13" rx="2.5" fill="#3b82f6" fill-opacity="0.22" /><text x="${TABLE_WIDTH - 22}" y="15" font-size="7.5" font-weight="bold" font-family="system-ui, sans-serif" fill="#2563eb" text-anchor="middle">FK</text>` : ''}
              </g>
            `
          })
          .join('')}
        ${
          extraCount > 0
            ? `<text x="${TABLE_WIDTH / 2}" y="${HEADER_HEIGHT + visibleColumns.length * ROW_HEIGHT + 15}" text-anchor="middle" font-size="8.5" font-family="system-ui, sans-serif" fill="${mutedColor}">+${extraCount} more fields</text>`
            : ''
        }
      </g>
    `)
  })

  return `<svg viewBox="${startViewX} ${startViewY} ${totalViewWidth} ${totalViewHeight}" preserveAspectRatio="xMidYMid meet" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">${svgElements.join('')}</svg>`
}

interface MermaidNode {
  id: string
  label: string
  shape: 'rect' | 'capsule' | 'diamond' | 'cylinder' | 'circle' | 'hexagon'
}

interface MermaidLink {
  from: string
  to: string
  label?: string
  isDotted?: boolean
}

function parseFlowchart(content: string) {
  const lines = content.split('\n')
  const nodesMap = new Map<string, MermaidNode>()
  const links: MermaidLink[] = []
  let direction = 'TD'

  const firstLine = lines.find((l) => l.trim() && !l.trim().startsWith('%%')) || ''
  const dirMatch = firstLine.match(/(?:flowchart|graph)\s+([A-Z]{2})/i)
  if (dirMatch) {
    direction = dirMatch[1].toUpperCase()
  }

  lines.forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('%%') || trimmed.startsWith('flowchart') || trimmed.startsWith('graph')) {
      return
    }

    const nodeDeclMatches = Array.from(
      trimmed.matchAll(/([a-zA-Z0-9_-]+)(?:(\(\[(.*?)\]\))|(\{(.*?)\})|(\(\((.*?)\)\))|(\{\{(.*?)\}\})|(\[\((.*?)\)\])|(\[(.*?)\]))/g)
    )

    nodeDeclMatches.forEach((nm) => {
      const id = nm[1]
      let label = id
      let shape: MermaidNode['shape'] = 'rect'

      if (nm[2]) {
        label = nm[3] || id
        shape = 'capsule'
      } else if (nm[4]) {
        label = nm[5] || id
        shape = 'diamond'
      } else if (nm[6]) {
        label = nm[7] || id
        shape = 'circle'
      } else if (nm[8]) {
        label = nm[9] || id
        shape = 'hexagon'
      } else if (nm[10]) {
        label = nm[11] || id
        shape = 'cylinder'
      } else if (nm[12]) {
        label = nm[13] || id
        shape = 'rect'
      }

      if (!nodesMap.has(id) || label !== id) {
        nodesMap.set(id, { id, label, shape })
      }
    })

    const linkRegex =
      /([a-zA-Z0-9_-]+)(?:(\(\[(.*?)\]\))|(\{(.*?)\})|(\(\((.*?)\)\))|(\{\{(.*?)\}\})|(\[\((.*?)\)\])|(\[(.*?)\]))?\s*(?:--\s*([^->\n]+?)\s*-->|-\.\s*([^->\n]+?)\s*\.->|==\s*([^->\n]+?)\s*==>|-->\s*\|([^|\n]+)\|\s*|-->|-\.->|==>|->|---)\s*([a-zA-Z0-9_-]+)(?:(\(\[(.*?)\]\))|(\{(.*?)\})|(\(\((.*?)\)\))|(\{\{(.*?)\}\})|(\[\((.*?)\)\])|(\[(.*?)\]))?/g

    let lm: RegExpExecArray | null
    while ((lm = linkRegex.exec(trimmed)) !== null) {
      const fromId = lm[1]
      const linkLabel = lm[14] || lm[15] || lm[16] || lm[17] || undefined
      const toId = lm[18]
      const isDotted = lm[0].includes('-.')

      if (!nodesMap.has(fromId)) {
        nodesMap.set(fromId, { id: fromId, label: fromId, shape: 'rect' })
      }
      if (!nodesMap.has(toId)) {
        nodesMap.set(toId, { id: toId, label: toId, shape: 'rect' })
      }

      links.push({ from: fromId, to: toId, label: linkLabel?.trim(), isDotted })
    }
  })

  return {
    direction,
    nodes: Array.from(nodesMap.values()),
    links,
  }
}

function renderFlowchartSvg(content: string, isDark = false): string {
  const parsed = parseFlowchart(content)
  const direction = parsed.direction
  const allNodes = parsed.nodes
  const allLinks = parsed.links

  if (allNodes.length === 0) {
    return ''
  }

  let nodes = allNodes
  let links = allLinks

  if (allNodes.length > MAX_THUMBNAIL_FLOWCHART_NODES) {
    const inDegree = new Map<string, number>()
    const adj = new Map<string, string[]>()
    allNodes.forEach((n) => {
      inDegree.set(n.id, 0)
      adj.set(n.id, [])
    })

    allLinks.forEach((l) => {
      inDegree.set(l.to, (inDegree.get(l.to) || 0) + 1)
      adj.get(l.from)?.push(l.to)
    })

    const rootNodes = allNodes.filter((n) => (inDegree.get(n.id) || 0) === 0)
    const startQueue = rootNodes.length > 0 ? rootNodes : [allNodes[0]]

    const selectedIds = new Set<string>()
    const queue: string[] = []

    startQueue.forEach((n) => {
      if (selectedIds.size < MAX_THUMBNAIL_FLOWCHART_NODES) {
        selectedIds.add(n.id)
        queue.push(n.id)
      }
    })

    while (queue.length > 0 && selectedIds.size < MAX_THUMBNAIL_FLOWCHART_NODES) {
      const curr = queue.shift()!
      const neighbors = adj.get(curr) || []
      for (const nxt of neighbors) {
        if (!selectedIds.has(nxt) && selectedIds.size < MAX_THUMBNAIL_FLOWCHART_NODES) {
          selectedIds.add(nxt)
          queue.push(nxt)
        }
      }
    }

    if (selectedIds.size < MAX_THUMBNAIL_FLOWCHART_NODES) {
      for (const n of allNodes) {
        if (selectedIds.size >= MAX_THUMBNAIL_FLOWCHART_NODES) break
        selectedIds.add(n.id)
      }
    }

    nodes = allNodes.filter((n) => selectedIds.has(n.id))
    links = allLinks.filter((l) => selectedIds.has(l.from) && selectedIds.has(l.to))
  }

  const isVertical = direction === 'TD' || direction === 'TB' || direction === 'BT'

  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  nodes.forEach((n) => {
    inDegree.set(n.id, 0)
    adj.set(n.id, [])
  })

  links.forEach((l) => {
    inDegree.set(l.to, (inDegree.get(l.to) || 0) + 1)
    adj.get(l.from)?.push(l.to)
  })

  const ranks = new Map<string, number>()
  const queue: { id: string; rank: number }[] = []

  nodes.forEach((n) => {
    if ((inDegree.get(n.id) || 0) === 0) {
      queue.push({ id: n.id, rank: 0 })
      ranks.set(n.id, 0)
    }
  })

  if (queue.length === 0 && nodes.length > 0) {
    queue.push({ id: nodes[0].id, rank: 0 })
    ranks.set(nodes[0].id, 0)
  }

  while (queue.length > 0) {
    const curr = queue.shift()!
    const neighbors = adj.get(curr.id) || []
    neighbors.forEach((nxt) => {
      const existingRank = ranks.get(nxt) ?? -1
      const nextRank = curr.rank + 1
      if (nextRank > existingRank) {
        ranks.set(nxt, nextRank)
        queue.push({ id: nxt, rank: nextRank })
      }
    })
  }

  nodes.forEach((n) => {
    if (!ranks.has(n.id)) {
      ranks.set(n.id, 0)
    }
  })

  const rankGroups = new Map<number, MermaidNode[]>()
  nodes.forEach((n) => {
    const r = ranks.get(n.id) || 0
    if (!rankGroups.has(r)) rankGroups.set(r, [])
    rankGroups.get(r)!.push(n)
  })

  const nodePositions = new Map<string, { x: number; y: number; width: number; height: number }>()

  const nodeW = 110
  const nodeH = 42
  const rankGap = isVertical ? 70 : 140
  const siblingGap = isVertical ? 135 : 60
  const pad = 36

  let maxR = 0
  rankGroups.forEach((groupNodes, r) => {
    if (r > maxR) maxR = r
    const totalSiblings = groupNodes.length
    groupNodes.forEach((n, idx) => {
      const offset = (idx - (totalSiblings - 1) / 2) * siblingGap
      if (isVertical) {
        nodePositions.set(n.id, {
          x: 200 + offset,
          y: pad + r * (nodeH + rankGap),
          width: nodeW,
          height: nodeH,
        })
      } else {
        nodePositions.set(n.id, {
          x: pad + r * (nodeW + rankGap),
          y: 200 + offset,
          width: nodeW,
          height: nodeH,
        })
      }
    })
  })

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  nodePositions.forEach((pos) => {
    minX = Math.min(minX, pos.x - pos.width / 2)
    minY = Math.min(minY, pos.y - pos.height / 2)
    maxX = Math.max(maxX, pos.x + pos.width / 2)
    maxY = Math.max(maxY, pos.y + pos.height / 2)
  })

  if (minX === Infinity) {
    minX = 0
    minY = 0
    maxX = 400
    maxY = 300
  }

  const totalWidth = maxX - minX + pad * 2
  const totalHeight = maxY - minY + pad * 2
  const startX = minX - pad
  const startY = minY - pad

  const cardBg = isDark ? '#09090b' : '#ffffff'
  const nodeBg = isDark ? '#18181b' : '#ffffff'
  const strokeColor = isDark ? '#a78bfa' : '#8b5cf6'
  const textColor = isDark ? '#ddd6fe' : '#7c3aed'
  const gridDotColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'

  const svgElements: string[] = [
    `<defs>
      <pattern id="mmGridFlow_${isDark ? 'dark' : 'light'}" width="20" height="20" patternUnits="userSpaceOnUse">
        <circle cx="10" cy="10" r="1" fill="${gridDotColor}" />
      </pattern>
      <marker id="mmArrow_${isDark ? 'dark' : 'light'}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="${strokeColor}" />
      </marker>
    </defs>`,
    `<rect x="${startX}" y="${startY}" width="${totalWidth}" height="${totalHeight}" fill="${cardBg}" />`,
    `<rect x="${startX}" y="${startY}" width="${totalWidth}" height="${totalHeight}" fill="url(#mmGridFlow_${isDark ? 'dark' : 'light'})" />`,
  ]

  links.forEach((link) => {
    const fromPos = nodePositions.get(link.from)
    const toPos = nodePositions.get(link.to)
    if (!fromPos || !toPos) return

    let sx = fromPos.x
    let sy = fromPos.y + fromPos.height / 2
    let tx = toPos.x
    let ty = toPos.y - toPos.height / 2

    if (!isVertical) {
      sx = fromPos.x + fromPos.width / 2
      sy = fromPos.y
      tx = toPos.x - toPos.width / 2
      ty = toPos.y
    }

    const midX = (sx + tx) / 2
    const midY = (sy + ty) / 2

    svgElements.push(`
      <path d="M ${sx} ${sy} Q ${midX} ${midY}, ${tx} ${ty}" stroke="${strokeColor}" stroke-width="2" fill="none" stroke-opacity="0.75" ${link.isDotted ? 'stroke-dasharray="4,4"' : ''} marker-end="url(#mmArrow_${isDark ? 'dark' : 'light'})" />
      ${
        link.label
          ? `<rect x="${midX - 14}" y="${midY - 7}" width="${link.label.length * 6 + 10}" height="14" rx="3" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1" stroke-opacity="0.3" />
             <text x="${midX}" y="${midY + 3}" text-anchor="middle" font-size="8.5" font-family="system-ui, sans-serif" font-weight="600" fill="${textColor}">${escapeXml(link.label)}</text>`
          : ''
      }
    `)
  })

  nodes.forEach((n) => {
    const pos = nodePositions.get(n.id)
    if (!pos) return
    const px = pos.x - pos.width / 2
    const py = pos.y - pos.height / 2

    let shapeSvg = ''
    if (n.shape === 'capsule') {
      shapeSvg = `<rect width="${pos.width}" height="${pos.height}" rx="21" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.8" stroke-opacity="0.85" />`
    } else if (n.shape === 'diamond') {
      const halfW = pos.width / 2
      const halfH = pos.height / 2
      shapeSvg = `<polygon points="${halfW},0 ${pos.width},${halfH} ${halfW},${pos.height} 0,${halfH}" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.8" stroke-opacity="0.85" />`
    } else if (n.shape === 'cylinder') {
      shapeSvg = `
        <path d="M 0 8 C 0 2, ${pos.width} 2, ${pos.width} 8 L ${pos.width} ${pos.height - 8} C ${pos.width} ${pos.height + 3}, 0 ${pos.height + 3}, 0 ${pos.height - 8} Z" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.8" stroke-opacity="0.85" />
        <ellipse cx="${pos.width / 2}" cy="8" rx="${pos.width / 2}" ry="5" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.8" stroke-opacity="0.85" />
      `
    } else if (n.shape === 'circle') {
      shapeSvg = `<circle cx="${pos.width / 2}" cy="${pos.height / 2}" r="${Math.min(pos.width, pos.height) / 2}" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.8" stroke-opacity="0.85" />`
    } else {
      shapeSvg = `<rect width="${pos.width}" height="${pos.height}" rx="7" fill="${nodeBg}" stroke="${strokeColor}" stroke-width="1.8" stroke-opacity="0.85" />`
    }

    svgElements.push(`
      <g transform="translate(${px}, ${py})">
        ${shapeSvg}
        <text x="${pos.width / 2}" y="${pos.height / 2 + 3.5}" text-anchor="middle" font-size="10.5" font-weight="600" font-family="system-ui, sans-serif" fill="${textColor}">${escapeXml(n.label.slice(0, 16))}</text>
      </g>
    `)
  })

  return `<svg viewBox="${startX} ${startY} ${totalWidth} ${totalHeight}" preserveAspectRatio="xMidYMid meet" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">${svgElements.join('')}</svg>`
}

function renderSequenceSvg(content: string, isDark = false): string {
  const lines = content.split('\n')
  const allParticipants: { id: string; label: string }[] = []
  const allMessages: { from: string; to: string; text: string; isReply?: boolean }[] = []
  let autoNumber = false

  lines.forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('%%')) return

    if (trimmed.startsWith('autonumber')) {
      autoNumber = true
      return
    }

    const partMatch = trimmed.match(/(?:participant|actor)\s+([a-zA-Z0-9_-]+)(?:\s+as\s+(.*))?/)
    if (partMatch) {
      allParticipants.push({
        id: partMatch[1],
        label: partMatch[2]?.replace(/^["']|["']$/g, '') || partMatch[1],
      })
      return
    }

    const msgMatch = trimmed.match(/([a-zA-Z0-9_-]+)\s*(-->>|->>|-x|-\))\s*([a-zA-Z0-9_-]+)\s*:\s*(.*)/)
    if (msgMatch) {
      const from = msgMatch[1]
      const arrow = msgMatch[2]
      const to = msgMatch[3]
      const text = msgMatch[4]

      if (!allParticipants.some((p) => p.id === from)) {
        allParticipants.push({ id: from, label: from })
      }
      if (!allParticipants.some((p) => p.id === to)) {
        allParticipants.push({ id: to, label: to })
      }

      allMessages.push({
        from,
        to,
        text,
        isReply: arrow.startsWith('--'),
      })
    }
  })

  if (allParticipants.length === 0) {
    return ''
  }

  const participants = allParticipants.slice(0, MAX_THUMBNAIL_PARTICIPANTS)
  const partIds = new Set(participants.map((p) => p.id))
  const messages = allMessages
    .filter((m) => partIds.has(m.from) && partIds.has(m.to))
    .slice(0, MAX_THUMBNAIL_MESSAGES)

  const partWidth = 100
  const partHeight = 32
  const spacingX = 145
  const padX = 36
  const padY = 26
  const stepHeight = 38

  const totalWidth = padX * 2 + Math.max(1, participants.length - 1) * spacingX + partWidth
  const totalHeight = padY * 2 + partHeight * 2 + Math.max(2, messages.length) * stepHeight + 30

  const partPositions = new Map<string, number>()
  participants.forEach((p, idx) => {
    const x = padX + idx * spacingX + partWidth / 2
    partPositions.set(p.id, x)
  })

  const cardBg = isDark ? '#09090b' : '#ffffff'
  const partBg = isDark ? '#18181b' : '#ffffff'
  const strokeColor = isDark ? '#a78bfa' : '#8b5cf6'
  const textColor = isDark ? '#ddd6fe' : '#7c3aed'
  const msgColor = isDark ? '#c4b5fd' : '#6d28d9'
  const gridDotColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'

  const svgElements: string[] = [
    `<defs>
      <pattern id="mmGridSeq_${isDark ? 'dark' : 'light'}" width="20" height="20" patternUnits="userSpaceOnUse">
        <circle cx="10" cy="10" r="1" fill="${gridDotColor}" />
      </pattern>
      <marker id="seqArrow_${isDark ? 'dark' : 'light'}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 2 L 10 5 L 0 8 z" fill="${strokeColor}" />
      </marker>
    </defs>`,
    `<rect width="${totalWidth}" height="${totalHeight}" fill="${cardBg}" />`,
    `<rect width="${totalWidth}" height="${totalHeight}" fill="url(#mmGridSeq_${isDark ? 'dark' : 'light'})" />`,
  ]

  const topY = padY
  const bottomY = totalHeight - padY - partHeight

  participants.forEach((p) => {
    const cx = partPositions.get(p.id)!

    svgElements.push(`
      <line x1="${cx}" y1="${topY + partHeight}" x2="${cx}" y2="${bottomY}" stroke="${strokeColor}" stroke-width="1.2" stroke-dasharray="4,4" stroke-opacity="0.4" />
      <g transform="translate(${cx - partWidth / 2}, ${topY})">
        <rect width="${partWidth}" height="${partHeight}" rx="5" fill="${partBg}" stroke="${strokeColor}" stroke-width="1.2" stroke-opacity="0.8" />
        <text x="${partWidth / 2}" y="${partHeight / 2 + 3.5}" text-anchor="middle" font-size="10" font-weight="600" font-family="system-ui, sans-serif" fill="${textColor}">${escapeXml(p.label.slice(0, 13))}</text>
      </g>
      <g transform="translate(${cx - partWidth / 2}, ${bottomY})">
        <rect width="${partWidth}" height="${partHeight}" rx="5" fill="${partBg}" stroke="${strokeColor}" stroke-width="1.2" stroke-opacity="0.8" />
        <text x="${partWidth / 2}" y="${partHeight / 2 + 3.5}" text-anchor="middle" font-size="10" font-weight="600" font-family="system-ui, sans-serif" fill="${textColor}">${escapeXml(p.label.slice(0, 13))}</text>
      </g>
    `)
  })

  let msgY = topY + partHeight + 20
  messages.forEach((msg, idx) => {
    const sx = partPositions.get(msg.from) || padX
    const tx = partPositions.get(msg.to) || padX + spacingX

    const isSelf = sx === tx
    const label = autoNumber ? `${idx + 1}. ${msg.text}` : msg.text

    if (isSelf) {
      svgElements.push(`
        <path d="M ${sx} ${msgY} C ${sx + 35} ${msgY - 8}, ${sx + 35} ${msgY + 16}, ${sx} ${msgY + 16}" stroke="${strokeColor}" stroke-width="1.2" fill="none" marker-end="url(#seqArrow_${isDark ? 'dark' : 'light'})" />
        <text x="${sx + 38}" y="${msgY + 6}" font-size="9" font-weight="500" font-family="system-ui, sans-serif" fill="${msgColor}">${escapeXml(label.slice(0, 18))}</text>
      `)
      msgY += stepHeight
    } else {
      svgElements.push(`
        <line x1="${sx}" y1="${msgY}" x2="${tx}" y2="${msgY}" stroke="${strokeColor}" stroke-width="1.2" ${msg.isReply ? 'stroke-dasharray="4,4"' : ''} marker-end="url(#seqArrow_${isDark ? 'dark' : 'light'})" />
        <text x="${(sx + tx) / 2}" y="${msgY - 4}" text-anchor="middle" font-size="9" font-weight="500" font-family="system-ui, sans-serif" fill="${msgColor}">${escapeXml(label.slice(0, 22))}</text>
      `)
      msgY += stepHeight
    }
  })

  return `<svg viewBox="0 0 ${totalWidth} ${totalHeight}" preserveAspectRatio="xMidYMid meet" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">${svgElements.join('')}</svg>`
}

export function generateMermaidThumbnail(content: string, isDark = false): string {
  const trimmed = content.trim()
  if (!trimmed) return ''

  if (/^sequenceDiagram/i.test(trimmed)) {
    return renderSequenceSvg(trimmed, isDark)
  }

  return renderFlowchartSvg(trimmed, isDark)
}

export async function generateMermaidThumbnailAsync(
  content: string,
  isDark = false
): Promise<string> {
  const trimmed = content.trim()
  if (!trimmed) return ''

  if (typeof window !== 'undefined') {
    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'default',
        securityLevel: 'loose',
        suppressErrorRendering: true,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      })
      const id = `mm_thumb_${Math.random().toString(36).substring(2, 9)}`
      const { svg } = await mermaid.render(id, trimmed)
      const errEl = document.getElementById(`d${id}`)
      if (errEl) errEl.remove()

      let clean = svg
      if (!clean.includes('preserveAspectRatio')) {
        clean = clean.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ')
      }
      return clean
    } catch {
      return generateMermaidThumbnail(trimmed, isDark)
    }
  }

  return generateMermaidThumbnail(trimmed, isDark)
}

export function svgToRasterThumbnail(
  svgString: string,
  width = 360,
  height = 240,
  backgroundColor = '#ffffff'
): Promise<string> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof document === 'undefined' || !svgString) {
      resolve(svgString)
      return
    }

    const img = new Image()
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          URL.revokeObjectURL(url)
          resolve(svgString)
          return
        }

        ctx.fillStyle = backgroundColor
        ctx.fillRect(0, 0, width, height)

        const imgAspect = (img.width || width) / (img.height || height)
        const canvasAspect = width / height

        let drawW = width
        let drawH = height
        let offsetX = 0
        let offsetY = 0

        if (imgAspect > canvasAspect) {
          drawW = width
          drawH = width / imgAspect
          offsetY = (height - drawH) / 2
        } else {
          drawH = height
          drawW = height * imgAspect
          offsetX = (width - drawW) / 2
        }

        ctx.drawImage(img, offsetX, offsetY, drawW, drawH)
        URL.revokeObjectURL(url)

        try {
          const webpData = canvas.toDataURL('image/webp', 0.85)
          if (webpData.startsWith('data:image/webp')) {
            resolve(webpData)
            return
          }
        } catch {}

        const pngData = canvas.toDataURL('image/png')
        resolve(pngData)
      } catch {
        URL.revokeObjectURL(url)
        resolve(svgString)
      }
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(svgString)
    }

    img.src = url
  })
}

export async function generateThumbnailAsync(
  type: DocType,
  content: string,
  docId?: string,
  isDark = false
): Promise<string> {
  const bgColor = isDark ? '#09090b' : '#ffffff'

  if (type === 'dbdiagram') {
    const svg = generateDbmlThumbnail(content, docId, isDark)
    if (!svg) return ''
    return svgToRasterThumbnail(svg, 360, 240, bgColor)
  }

  if (type === 'mermaid') {
    const svg = await generateMermaidThumbnailAsync(content, isDark)
    if (!svg) return ''
    return svgToRasterThumbnail(svg, 360, 240, bgColor)
  }

  return ''
}

export async function generateDualThumbnailsAsync(
  type: DocType,
  content: string,
  docId?: string
): Promise<{ thumbnail: string; thumbnailDark: string }> {
  const [thumbnail, thumbnailDark] = await Promise.all([
    generateThumbnailAsync(type, content, docId, false),
    generateThumbnailAsync(type, content, docId, true),
  ])
  return { thumbnail, thumbnailDark }
}
