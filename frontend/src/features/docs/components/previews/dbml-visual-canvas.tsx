import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Key,
  Layers,
  Link2,
  RotateCcw,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface DbmlVisualCanvasProps {
  docId?: string
  content: string
}

interface TableColumn {
  name: string
  type: string
  isPk: boolean
  isFk: boolean
  isUnique: boolean
  fkTarget?: {
    table: string
    column: string
    relType: string
  }
}

interface TableIndex {
  columns: string[]
  name?: string
  isUnique: boolean
  isPk: boolean
}

interface ParsedTable {
  name: string
  alias?: string
  headerColor?: string
  columns: TableColumn[]
  indexes: TableIndex[]
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
  relType: '>' | '<' | '-'
  raw: string
}

interface TablePosition {
  x: number
  y: number
}

const TABLE_WIDTH = 280
const HEADER_HEIGHT = 42
const ROW_HEIGHT = 30
const INDEX_ROW_HEIGHT = 26
const INDEX_HEADER_HEIGHT = 28

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

export interface JointPoint {
  x: number
  y: number
  axis?: 'x' | 'y'
}

export interface SegmentInfo {
  p1: JointPoint
  p2: JointPoint
  insertIndex: number
}

export interface GhostJoint {
  relKey: string
  insertIndex: number
  x: number
  y: number
  axis: 'x' | 'y'
}

function getPathLength(points: JointPoint[]): number {
  return points.slice(1).reduce((total, point, index) => {
    const previous = points[index]
    return total + Math.hypot(point.x - previous.x, point.y - previous.y)
  }, 0)
}

function getPointAtDistance(points: JointPoint[], targetDistance: number): JointPoint {
  let traversed = 0

  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index]
    const end = points[index + 1]
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    if (length < 0.5) continue

    if (traversed + length >= targetDistance || index === points.length - 2) {
      const ratio = Math.max(0, Math.min(1, (targetDistance - traversed) / length))
      return {
        x: Math.round(start.x + dx * ratio),
        y: Math.round(start.y + dy * ratio),
        axis: Math.abs(dx) < Math.abs(dy) ? 'x' : 'y',
      }
    }

    traversed += length
  }

  return { ...points[points.length - 1] }
}

export function getDefaultEdgeJoints(points: JointPoint[]): JointPoint[] {
  const length = getPathLength(points)
  return [0.25, 0.5, 0.75].map((ratio) =>
    getPointAtDistance(points, length * ratio)
  )
}

function getDistanceAlongPath(
  points: JointPoint[],
  target: JointPoint,
  minimumDistance: number
): number {
  let traversed = 0
  let bestDistance = minimumDistance
  let bestGap = Infinity

  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index]
    const end = points[index + 1]
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    const length = Math.sqrt(lengthSquared)
    if (length < 0.5) continue

    const ratio = Math.max(
      0,
      Math.min(1, ((target.x - start.x) * dx + (target.y - start.y) * dy) / lengthSquared)
    )
    const distance = traversed + ratio * length
    const gap = Math.hypot(
      target.x - (start.x + ratio * dx),
      target.y - (start.y + ratio * dy)
    )

    if (distance >= minimumDistance - 0.5 && gap < bestGap) {
      bestDistance = distance
      bestGap = gap
    }

    traversed += length
  }

  return bestDistance
}

export function getGhostJointCandidates(
  pathPoints: JointPoint[],
  joints: JointPoint[]
): Omit<GhostJoint, 'relKey'>[] {
  const pathLength = getPathLength(pathPoints)
  const distances = [0]

  for (let index = 1; index < joints.length - 1; index++) {
    distances.push(getDistanceAlongPath(pathPoints, joints[index], distances[index - 1]))
  }
  distances.push(pathLength)

  return distances.slice(0, -1).flatMap((distance, insertIndex) => {
    const nextDistance = distances[insertIndex + 1]
    if (nextDistance - distance < 1) return []
    const point = getPointAtDistance(pathPoints, (distance + nextDistance) / 2)
    return [
      {
        ...point,
        axis: point.axis || 'x',
        insertIndex,
      },
    ]
  })
}

interface RawPointWithMeta {
  x: number
  y: number
  insertIndex: number
}

function computeCleanedOrthogonalPointsWithSegments(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  fromIsLeft: boolean,
  joints: JointPoint[]
): {
  cleaned: JointPoint[]
  segments: SegmentInfo[]
} {
  const raw: RawPointWithMeta[] = [{ x: startX, y: startY, insertIndex: 0 }]

  if (joints.length === 0) {
    const isNormal = fromIsLeft ? endX > startX + 24 : startX > endX + 24
    if (isNormal) {
      const midX = Math.round((startX + endX) / 2)
      raw.push({ x: midX, y: startY, insertIndex: 0 })
      raw.push({ x: midX, y: endY, insertIndex: 0 })
      raw.push({ x: endX, y: endY, insertIndex: 1 })
    } else {
      const offsetX = fromIsLeft ? startX + 28 : startX - 28
      const targetOffsetX = fromIsLeft ? endX - 28 : endX + 28
      const midY = Math.round((startY + endY) / 2)
      raw.push({ x: offsetX, y: startY, insertIndex: 0 })
      raw.push({ x: offsetX, y: midY, insertIndex: 0 })
      raw.push({ x: targetOffsetX, y: midY, insertIndex: 0 })
      raw.push({ x: targetOffsetX, y: endY, insertIndex: 1 })
      raw.push({ x: endX, y: endY, insertIndex: 1 })
    }
  } else {
    for (let i = 0; i < joints.length; i++) {
      const curr = joints[i]
      const currAxis = curr.axis || 'x'

      if (i === 0) {
        if (currAxis === 'x') {
          raw.push({ x: curr.x, y: startY, insertIndex: 0 })
          raw.push({ x: curr.x, y: curr.y, insertIndex: 0 })
        } else {
          const stepX = Math.round((startX + curr.x) / 2)
          raw.push({ x: stepX, y: startY, insertIndex: 0 })
          raw.push({ x: stepX, y: curr.y, insertIndex: 0 })
          raw.push({ x: curr.x, y: curr.y, insertIndex: 0 })
        }
      } else {
        const prev = joints[i - 1]
        const prevAxis = prev.axis || 'x'

        if (prevAxis === 'x' && currAxis === 'y') {
          raw.push({ x: prev.x, y: curr.y, insertIndex: i })
          raw.push({ x: curr.x, y: curr.y, insertIndex: i })
        } else if (prevAxis === 'y' && currAxis === 'x') {
          raw.push({ x: curr.x, y: prev.y, insertIndex: i })
          raw.push({ x: curr.x, y: curr.y, insertIndex: i })
        } else if (prevAxis === 'x' && currAxis === 'x') {
          const stepY = Math.round((prev.y + curr.y) / 2)
          raw.push({ x: prev.x, y: stepY, insertIndex: i })
          raw.push({ x: curr.x, y: stepY, insertIndex: i })
          raw.push({ x: curr.x, y: curr.y, insertIndex: i })
        } else {
          const stepX = Math.round((prev.x + curr.x) / 2)
          raw.push({ x: stepX, y: prev.y, insertIndex: i })
          raw.push({ x: stepX, y: curr.y, insertIndex: i })
          raw.push({ x: curr.x, y: curr.y, insertIndex: i })
        }
      }
    }

    const lastJoint = joints[joints.length - 1]
    const lastAxis = lastJoint.axis || 'x'

    if (lastAxis === 'x') {
      raw.push({ x: lastJoint.x, y: endY, insertIndex: joints.length })
      raw.push({ x: endX, y: endY, insertIndex: joints.length })
    } else {
      const stepX = Math.round((lastJoint.x + endX) / 2)
      raw.push({ x: stepX, y: lastJoint.y, insertIndex: joints.length })
      raw.push({ x: stepX, y: endY, insertIndex: joints.length })
      raw.push({ x: endX, y: endY, insertIndex: joints.length })
    }
  }

  const simplified: RawPointWithMeta[] = []
  for (let i = 0; i < raw.length; i++) {
    const pt = raw[i]
    if (
      simplified.length > 0 &&
      Math.abs(simplified[simplified.length - 1].x - pt.x) < 0.5 &&
      Math.abs(simplified[simplified.length - 1].y - pt.y) < 0.5
    ) {
      continue
    }
    simplified.push(pt)
  }

  const cleaned: RawPointWithMeta[] = []
  for (let i = 0; i < simplified.length; i++) {
    if (i === 0 || i === simplified.length - 1) {
      cleaned.push(simplified[i])
      continue
    }
    const prev = cleaned[cleaned.length - 1]
    const curr = simplified[i]
    const next = simplified[i + 1]

    if (
      (Math.abs(prev.x - curr.x) < 0.5 && Math.abs(curr.x - next.x) < 0.5) ||
      (Math.abs(prev.y - curr.y) < 0.5 && Math.abs(curr.y - next.y) < 0.5)
    ) {
      continue
    }
    cleaned.push(curr)
  }

  if (cleaned.length < 2) {
    return {
      cleaned: [
        { x: startX, y: startY },
        { x: endX, y: endY },
      ],
      segments: [
        {
          p1: { x: startX, y: startY },
          p2: { x: endX, y: endY },
          insertIndex: 0,
        },
      ],
    }
  }

  const segments: SegmentInfo[] = []
  for (let i = 0; i < cleaned.length - 1; i++) {
    const p1 = { x: cleaned[i].x, y: cleaned[i].y }
    const p2 = { x: cleaned[i + 1].x, y: cleaned[i + 1].y }
    const segLength = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    if (segLength > 0.5) {
      segments.push({
        p1,
        p2,
        insertIndex: cleaned[i].insertIndex,
      })
    }
  }

  return {
    cleaned: cleaned.map((c) => ({ x: c.x, y: c.y })),
    segments,
  }
}

function generateRoundedOrthogonalPathFromPoints(
  cleaned: JointPoint[],
  radius: number = 8
): string {
  if (cleaned.length < 2) {
    return ''
  }
  if (cleaned.length === 2) {
    return `M ${cleaned[0].x} ${cleaned[0].y} L ${cleaned[1].x} ${cleaned[1].y}`
  }

  let d = `M ${cleaned[0].x} ${cleaned[0].y}`
  for (let i = 1; i < cleaned.length - 1; i++) {
    const prev = cleaned[i - 1]
    const curr = cleaned[i]
    const next = cleaned[i + 1]

    const distPrev = Math.hypot(curr.x - prev.x, curr.y - prev.y)
    const distNext = Math.hypot(next.x - curr.x, next.y - curr.y)
    const r = Math.min(radius, distPrev / 2, distNext / 2)

    if (r < 1) {
      d += ` L ${curr.x} ${curr.y}`
      continue
    }

    const dirPrevX = (prev.x - curr.x) / distPrev
    const dirPrevY = (prev.y - curr.y) / distPrev
    const dirNextX = (next.x - curr.x) / distNext
    const dirNextY = (next.y - curr.y) / distNext

    const startCornerX = curr.x + dirPrevX * r
    const startCornerY = curr.y + dirPrevY * r
    const endCornerX = curr.x + dirNextX * r
    const endCornerY = curr.y + dirNextY * r

    d += ` L ${startCornerX.toFixed(1)} ${startCornerY.toFixed(1)}`
    d += ` Q ${curr.x} ${curr.y} ${endCornerX.toFixed(1)} ${endCornerY.toFixed(1)}`
  }

  d += ` L ${cleaned[cleaned.length - 1].x} ${cleaned[cleaned.length - 1].y}`
  return d
}

function calculateTableHeight(table: ParsedTable): number {
  let height = HEADER_HEIGHT + table.columns.length * ROW_HEIGHT + 8
  if (table.indexes.length > 0) {
    height += INDEX_HEADER_HEIGHT + table.indexes.length * INDEX_ROW_HEIGHT + 6
  }
  return height
}

export function DbmlVisualCanvas({ docId, content }: DbmlVisualCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 60, y: 60 })

  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => {
    panRef.current = pan
  }, [pan])

  const [tablePositions, setTablePositions] = useState<Record<string, TablePosition>>(() => {
    if (docId) {
      try {
        const saved = localStorage.getItem(`dokudocs_dbml_layout_${docId}`)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (parsed.tablePositions) {
            return parsed.tablePositions
          }
        }
      } catch (e) {}
    }
    return {}
  })

  const [edgeJoints, setEdgeJoints] = useState<Record<string, JointPoint[]>>(() => {
    if (docId) {
      try {
        const saved = localStorage.getItem(`dokudocs_dbml_layout_${docId}`)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (parsed.edgeJoints) {
            return parsed.edgeJoints
          }
        }
      } catch (e) {}
    }
    return {}
  })

  const [draggingJoint, setDraggingJoint] = useState<{
    relKey: string
    jointIndex: number
    startX: number
    startY: number
    initialJoints: JointPoint[]
    axis: 'x' | 'y'
    hasMoved: boolean
    isGhost?: boolean
  } | null>(null)

  const [ghostJoint, setGhostJoint] = useState<GhostJoint | null>(null)

  const [draggingTable, setDraggingTable] = useState<{
    id: string
    startX: number
    startY: number
    origX: number
    origY: number
    hasMoved: boolean
  } | null>(null)

  const [canvasPanning, setCanvasPanning] = useState<{
    startX: number
    startY: number
    origPanX: number
    origPanY: number
  } | null>(null)

  const [hoveredTable, setHoveredTable] = useState<string | null>(null)
  const [hoveredField, setHoveredField] = useState<{ table: string; column: string } | null>(null)
  const [hoveredRelation, setHoveredRelation] = useState<string | null>(null)

  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [selectedField, setSelectedField] = useState<{ table: string; column: string } | null>(null)
  const [selectedRelation, setSelectedRelation] = useState<string | null>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedTable(null)
        setSelectedField(null)
        setSelectedRelation(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const { parsedTables, parsedRelations, parsedTableGroups } = useMemo(() => {
    const cleanContent = stripDbmlComments(content)
    if (!cleanContent.trim()) {
      return { parsedTables: [], parsedRelations: [], parsedTableGroups: [] }
    }

    const relations: ParsedRelation[] = []

    const standaloneRefRegex =
      /Ref\s*(?:[\w]+)?\s*:\s*([\w]+)\.([\w]+)\s*([><-])\s*([\w]+)\.([\w]+)/gi
    let refMatch: RegExpExecArray | null
    while ((refMatch = standaloneRefRegex.exec(cleanContent)) !== null) {
      relations.push({
        fromTable: refMatch[1],
        fromColumn: refMatch[2],
        toTable: refMatch[4],
        toColumn: refMatch[5],
        relType: refMatch[3] as '>' | '<' | '-',
        raw: refMatch[0],
      })
    }

    const refBlockRegex = /Ref\s*(?:[\w]+)?\s*\{([^}]+)\}/gi
    let blockMatch: RegExpExecArray | null
    while ((blockMatch = refBlockRegex.exec(cleanContent)) !== null) {
      const blockContent = blockMatch[1]
      const lineRefs = blockContent.split('\n')
      lineRefs.forEach((line) => {
        const trimmed = line.trim()
        if (!trimmed) return
        const lineMatch = trimmed.match(
          /([\w]+)\.([\w]+)\s*([><-])\s*([\w]+)\.([\w]+)/
        )
        if (lineMatch) {
          relations.push({
            fromTable: lineMatch[1],
            fromColumn: lineMatch[2],
            toTable: lineMatch[4],
            toColumn: lineMatch[5],
            relType: lineMatch[3] as '>' | '<' | '-',
            raw: lineMatch[0],
          })
        }
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
        .map((l) => l.trim())
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

    const tables: ParsedTable[] = []
    const tableRegex =
      /Table\s+(\w+)(?:\s+as\s+(\w+))?\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/gi

    let match: RegExpExecArray | null
    while ((match = tableRegex.exec(cleanContent)) !== null) {
      const tableName = match[1]
      const alias = match[2]
      const tableOpts = match[3] || ''
      const body = match[4]

      let headerColor: string | undefined = undefined
      const colorMatch = tableOpts.match(
        /(?:headercolor|color|fill)\s*:\s*['"]?([#\w]+)['"]?/i
      )
      if (colorMatch) {
        headerColor = colorMatch[1]
      }

      let indexes: TableIndex[] = []
      let bodyWithoutIndexes = body

      const indexesMatch = body.match(/indexes\s*\{([^}]+)\}/i)
      if (indexesMatch) {
        bodyWithoutIndexes = body.replace(/indexes\s*\{([^}]+)\}/i, '')
        const idxLines = indexesMatch[1].split('\n')
        idxLines.forEach((line) => {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('//')) return

          const compMatch = trimmed.match(/^\(([^)]+)\)(.*)$/)
          if (compMatch) {
            const cols = compMatch[1].split(',').map((c) => c.trim())
            const opts = compMatch[2] || ''
            const nameMatch = opts.match(/name:\s*['"]?([\w]+)['"]?/i)
            indexes.push({
              columns: cols,
              name: nameMatch ? nameMatch[1] : undefined,
              isUnique: /unique/i.test(opts),
              isPk: /pk/i.test(opts),
            })
          } else {
            const singleMatch = trimmed.match(/^(\w+)(.*)$/)
            if (singleMatch) {
              const col = singleMatch[1]
              const opts = singleMatch[2] || ''
              const nameMatch = opts.match(/name:\s*['"]?([\w]+)['"]?/i)
              indexes.push({
                columns: [col],
                name: nameMatch ? nameMatch[1] : undefined,
                isUnique: /unique/i.test(opts),
                isPk: /pk/i.test(opts),
              })
            }
          }
        })
      }

      const lines = bodyWithoutIndexes.split('\n')
      const columns: TableColumn[] = []

      lines.forEach((line) => {
        const trimmed = line.trim()
        if (
          !trimmed ||
          trimmed.startsWith('indexes') ||
          trimmed.startsWith('Note:') ||
          trimmed.startsWith('//')
        )
          return

        const colMatch = trimmed.match(/^(\w+)\s+([\w()]+)(.*)$/)
        if (colMatch) {
          const colName = colMatch[1]
          const colType = colMatch[2]
          const colOpts = colMatch[3] || ''

          let isFk = false
          let fkTarget: TableColumn['fkTarget'] = undefined

          const inlineRefMatch = colOpts.match(
            /ref:\s*([><-])\s*([\w]+)\.([\w]+)/i
          )
          if (inlineRefMatch) {
            isFk = true
            fkTarget = {
              table: inlineRefMatch[2],
              column: inlineRefMatch[3],
              relType: inlineRefMatch[1],
            }
            relations.push({
              fromTable: tableName,
              fromColumn: colName,
              toTable: inlineRefMatch[2],
              toColumn: inlineRefMatch[3],
              relType: inlineRefMatch[1] as '>' | '<' | '-',
              raw: `[${inlineRefMatch[0]}]`,
            })
          }

          const standaloneRel = relations.find(
            (r) =>
              r.fromTable.toLowerCase() === tableName.toLowerCase() &&
              r.fromColumn.toLowerCase() === colName.toLowerCase()
          )
          if (standaloneRel) {
            isFk = true
            fkTarget = {
              table: standaloneRel.toTable,
              column: standaloneRel.toColumn,
              relType: standaloneRel.relType,
            }
          }

          columns.push({
            name: colName,
            type: colType,
            isPk: colOpts.includes('pk') || colOpts.includes('primary key'),
            isFk,
            isUnique: colOpts.includes('unique'),
            fkTarget,
          })
        }
      })

      tables.push({ name: tableName, alias, headerColor, columns, indexes })
    }

    return {
      parsedTables: tables,
      parsedRelations: relations,
      parsedTableGroups: tableGroups,
    }
  }, [content])

  const calculateAutoLayout = useCallback(
    (tables: ParsedTable[], groups: ParsedTableGroup[]) => {
      const nextPositions: Record<string, TablePosition> = {}
      const assigned = new Set<string>()

      let curX = 60
      let curY = 60

      groups.forEach((group) => {
        const groupMembers = tables.filter((t) =>
          group.tables.some((gt) => gt.toLowerCase() === t.name.toLowerCase())
        )

        if (groupMembers.length === 0) return

        const colsCount = Math.min(Math.ceil(Math.sqrt(groupMembers.length)), 3)
        let groupColX = curX + 32
        let groupRowY = curY + 48
        let maxColHeight = 0
        let groupMaxX = 0

        const colHeights = new Array(colsCount).fill(groupRowY)

        groupMembers.forEach((t) => {
          assigned.add(t.name)
          let minColIdx = 0
          for (let i = 1; i < colsCount; i++) {
            if (colHeights[i] < colHeights[minColIdx]) {
              minColIdx = i
            }
          }

          const posX = groupColX + minColIdx * (TABLE_WIDTH + 48)
          const posY = colHeights[minColIdx]
          const tHeight = calculateTableHeight(t)

          nextPositions[t.name] = { x: posX, y: posY }
          colHeights[minColIdx] += tHeight + 36

          groupMaxX = Math.max(groupMaxX, posX + TABLE_WIDTH)
          maxColHeight = Math.max(maxColHeight, colHeights[minColIdx])
        })

        curX = groupMaxX + 80
      })

      const ungrouped = tables.filter((t) => !assigned.has(t.name))
      if (ungrouped.length > 0) {
        let colHeights = [curY, curY, curY]
        ungrouped.forEach((t) => {
          let minColIdx = 0
          for (let i = 1; i < 3; i++) {
            if (colHeights[i] < colHeights[minColIdx]) {
              minColIdx = i
            }
          }

          const posX = curX + minColIdx * (TABLE_WIDTH + 48)
          const posY = colHeights[minColIdx]
          const tHeight = calculateTableHeight(t)

          nextPositions[t.name] = { x: posX, y: posY }
          colHeights[minColIdx] += tHeight + 36
        })
      }

      return nextPositions
    },
    []
  )

  useEffect(() => {
    setTablePositions((prev) => {
      let hasMissing = false
      parsedTables.forEach((t) => {
        if (!prev[t.name]) {
          hasMissing = true
        }
      })

      if (!hasMissing && Object.keys(prev).length > 0) {
        return prev
      }

      const auto = calculateAutoLayout(parsedTables, parsedTableGroups)
      const merged = { ...auto, ...prev }
      parsedTables.forEach((t) => {
        if (!merged[t.name]) {
          merged[t.name] = auto[t.name] || { x: 60, y: 60 }
        }
      })

      if (docId) {
        try {
          const storageKey = `dokudocs_dbml_layout_${docId}`
          const saved = localStorage.getItem(storageKey)
          const storedLayout = saved ? JSON.parse(saved) : {}
          localStorage.setItem(
            storageKey,
            JSON.stringify({
              ...storedLayout,
              tablePositions: merged,
              zoom: zoomRef.current,
              pan: panRef.current,
            })
          )
        } catch (e) {}
      }

      return merged
    })
  }, [parsedTables, parsedTableGroups, calculateAutoLayout, docId])

  const handleApplyAutoLayout = () => {
    const layout = calculateAutoLayout(parsedTables, parsedTableGroups)
    setTablePositions(layout)
    setEdgeJoints({})
    if (docId) {
      try {
        localStorage.setItem(
          `dokudocs_dbml_layout_${docId}`,
          JSON.stringify({
            tablePositions: layout,
            edgeJoints: {},
            zoom: zoomRef.current,
            pan: panRef.current,
          })
        )
      } catch (e) {}
    }
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()

      const rect = viewport.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const currentZoom = zoomRef.current
      const currentPan = panRef.current

      if (e.ctrlKey || e.metaKey) {
        const zoomDelta = -e.deltaY * 0.003
        const newZoom = Math.min(Math.max(currentZoom + zoomDelta, 0.2), 3)

        const worldX = (mouseX - currentPan.x) / currentZoom
        const worldY = (mouseY - currentPan.y) / currentZoom

        const newPanX = mouseX - worldX * newZoom
        const newPanY = mouseY - worldY * newZoom

        zoomRef.current = newZoom
        panRef.current = { x: newPanX, y: newPanY }

        setZoom(newZoom)
        setPan({ x: newPanX, y: newPanY })
      } else {
        const newPanX = currentPan.x - e.deltaX
        const newPanY = currentPan.y - e.deltaY
        panRef.current = { x: newPanX, y: newPanY }
        setPan({ x: newPanX, y: newPanY })
      }
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      viewport.removeEventListener('wheel', handleWheel)
    }
  }, [])

  const getCanvasCoords = useCallback((clientX: number, clientY: number) => {
    const viewport = viewportRef.current
    if (!viewport) return { x: 0, y: 0 }
    const rect = viewport.getBoundingClientRect()
    const worldX = (clientX - rect.left - panRef.current.x) / zoomRef.current
    const worldY = (clientY - rect.top - panRef.current.y) / zoomRef.current
    return { x: worldX, y: worldY }
  }, [])

  useEffect(() => {
    if (!draggingTable && !canvasPanning && !draggingJoint) return

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (draggingJoint) {
        const dx = (e.clientX - draggingJoint.startX) / zoomRef.current
        const dy = (e.clientY - draggingJoint.startY) / zoomRef.current
        const activationDistance = draggingJoint.isGhost ? 3 : 1
        if (
          !draggingJoint.hasMoved &&
          Math.hypot(e.clientX - draggingJoint.startX, e.clientY - draggingJoint.startY) <=
            activationDistance
        )
          return
        draggingJoint.hasMoved = true
        const target = draggingJoint.initialJoints[draggingJoint.jointIndex]
        const axis = draggingJoint.axis

        let newX = target.x
        let newY = target.y

        const snapThreshold = 6
        const joints = draggingJoint.initialJoints
        const jIdx = draggingJoint.jointIndex

        const snapTargets: JointPoint[] = []
        if (jIdx > 0) snapTargets.push(joints[jIdx - 1])
        if (jIdx < joints.length - 1) snapTargets.push(joints[jIdx + 1])

        if (axis === 'x') {
          newX = Math.round(target.x + dx)
          for (const st of snapTargets) {
            if (Math.abs(newX - st.x) <= snapThreshold) {
              newX = st.x
            }
          }
        } else {
          newY = Math.round(target.y + dy)
          for (const st of snapTargets) {
            if (Math.abs(newY - st.y) <= snapThreshold) {
              newY = st.y
            }
          }
        }

        const nextJoints: JointPoint[] = joints.map((j, i) =>
          i === jIdx ? { ...j, x: newX, y: newY, axis } : { ...j }
        )

        setEdgeJoints((prev) => ({
          ...prev,
          [draggingJoint.relKey]: nextJoints,
        }))
      } else if (draggingTable) {
        const dx = (e.clientX - draggingTable.startX) / zoomRef.current
        const dy = (e.clientY - draggingTable.startY) / zoomRef.current
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          draggingTable.hasMoved = true
        }
        setTablePositions((prev) => {
          const next = {
            ...prev,
            [draggingTable.id]: {
              x: draggingTable.origX + dx,
              y: draggingTable.origY + dy,
            },
          }
          return next
        })
      } else if (canvasPanning) {
        const dx = e.clientX - canvasPanning.startX
        const dy = e.clientY - canvasPanning.startY
        const nextPan = {
          x: canvasPanning.origPanX + dx,
          y: canvasPanning.origPanY + dy,
        }
        panRef.current = nextPan
        setPan(nextPan)
      }
    }

    const handleWindowMouseUp = () => {
      if (draggingJoint && draggingJoint.hasMoved && docId) {
        setEdgeJoints((current) => {
          try {
            const saved = localStorage.getItem(`dokudocs_dbml_layout_${docId}`)
            const parsed = saved ? JSON.parse(saved) : {}
            localStorage.setItem(
              `dokudocs_dbml_layout_${docId}`,
              JSON.stringify({
                ...parsed,
                edgeJoints: current,
                zoom: zoomRef.current,
                pan: panRef.current,
              })
            )
          } catch (e) {}
          return current
        })
      }
      if (draggingTable && draggingTable.hasMoved && docId) {
        setTablePositions((current) => {
          try {
            const saved = localStorage.getItem(`dokudocs_dbml_layout_${docId}`)
            const parsed = saved ? JSON.parse(saved) : {}
            localStorage.setItem(
              `dokudocs_dbml_layout_${docId}`,
              JSON.stringify({
                ...parsed,
                tablePositions: current,
                zoom: zoomRef.current,
                pan: panRef.current,
              })
            )
          } catch (e) {}
          return current
        })
      }
      setDraggingJoint(null)
      setDraggingTable(null)
      setCanvasPanning(null)
    }

    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
  }, [draggingTable, canvasPanning, draggingJoint, docId])

  const handleMouseDownBackground = (e: React.MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    setSelectedTable(null)
    setSelectedField(null)
    setSelectedRelation(null)
    setGhostJoint(null)
    setCanvasPanning({
      startX: e.clientX,
      startY: e.clientY,
      origPanX: panRef.current.x,
      origPanY: panRef.current.y,
    })
  }

  const handleMouseDownTable = (tableName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setGhostJoint(null)
    const cur = tablePositions[tableName] || { x: 60, y: 60 }
    setDraggingTable({
      id: tableName,
      startX: e.clientX,
      startY: e.clientY,
      origX: cur.x,
      origY: cur.y,
      hasMoved: false,
    })
  }

  const handleJointMouseDown = (
    e: React.MouseEvent,
    relKey: string,
    jointIndex: number,
    joints: JointPoint[]
  ) => {
    e.stopPropagation()
    setGhostJoint(null)
    const target = joints[jointIndex]
    const axis = target?.axis || 'x'
    setDraggingJoint({
      relKey,
      jointIndex,
      startX: e.clientX,
      startY: e.clientY,
      initialJoints: joints.map((j) => ({ ...j })),
      axis,
      hasMoved: false,
    })
  }

  const handleGhostJointMouseDown = (
    e: React.MouseEvent,
    ghost: GhostJoint,
    currentJoints: JointPoint[]
  ) => {
    e.stopPropagation()
    const nextJoints = [...currentJoints]
    nextJoints.splice(ghost.insertIndex, 0, {
      x: ghost.x,
      y: ghost.y,
      axis: ghost.axis,
    })

    setDraggingJoint({
      relKey: ghost.relKey,
      jointIndex: ghost.insertIndex,
      startX: e.clientX,
      startY: e.clientY,
      initialJoints: nextJoints,
      axis: ghost.axis,
      hasMoved: false,
      isGhost: true,
    })

    setGhostJoint(null)
  }

  const handleResetEdgeJoints = (e: React.MouseEvent, relKey: string) => {
    e.stopPropagation()
    setGhostJoint(null)
    setEdgeJoints((prev) => {
      const next = { ...prev }
      delete next[relKey]
      if (docId) {
        try {
          const saved = localStorage.getItem(`dokudocs_dbml_layout_${docId}`)
          const parsed = saved ? JSON.parse(saved) : {}
          localStorage.setItem(
            `dokudocs_dbml_layout_${docId}`,
            JSON.stringify({
              ...parsed,
              edgeJoints: next,
            })
          )
        } catch (err) {}
      }
      return next
    })
  }

  const handleJointDoubleClick = (
    e: React.MouseEvent,
    relKey: string,
    jointIndex: number,
    currentJoints: JointPoint[]
  ) => {
    e.stopPropagation()
    setGhostJoint(null)
    setEdgeJoints((prev) => {
      const next = {
        ...prev,
        [relKey]: currentJoints.filter((_, idx) => idx !== jointIndex),
      }

      if (docId) {
        try {
          const saved = localStorage.getItem(`dokudocs_dbml_layout_${docId}`)
          const parsed = saved ? JSON.parse(saved) : {}
          localStorage.setItem(
            `dokudocs_dbml_layout_${docId}`,
            JSON.stringify({
              ...parsed,
              edgeJoints: next,
            })
          )
        } catch (err) {}
      }
      return next
    })
  }

  const handleRelationMouseMove = (
    e: React.MouseEvent,
    relKey: string,
    candidates: Omit<GhostJoint, 'relKey'>[]
  ) => {
    if (draggingJoint) return
    const { x: mouseX, y: mouseY } = getCanvasCoords(e.clientX, e.clientY)

    const candidate = candidates
      .map((item) => ({
        ...item,
        distance: Math.hypot(mouseX - item.x, mouseY - item.y),
      }))
      .filter((item) => item.distance <= 16)
      .sort((a, b) => a.distance - b.distance)[0]

    if (candidate) {
      setGhostJoint({
        relKey,
        insertIndex: candidate.insertIndex,
        x: candidate.x,
        y: candidate.y,
        axis: candidate.axis,
      })
    } else {
      setGhostJoint(null)
    }
  }

  const renderedGroups = useMemo(() => {
    return parsedTableGroups
      .map((group) => {
        const members = parsedTables.filter((t) =>
          group.tables.some((gt) => gt.toLowerCase() === t.name.toLowerCase())
        )

        if (members.length === 0) return null

        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity

        members.forEach((t) => {
          const pos = tablePositions[t.name] || { x: 60, y: 60 }
          const tHeight = calculateTableHeight(t)
          minX = Math.min(minX, pos.x)
          minY = Math.min(minY, pos.y)
          maxX = Math.max(maxX, pos.x + TABLE_WIDTH)
          maxY = Math.max(maxY, pos.y + tHeight)
        })

        if (minX === Infinity) return null

        const padding = 20
        return {
          name: group.name,
          color: group.color,
          x: minX - padding,
          y: minY - padding - 24,
          width: maxX - minX + padding * 2,
          height: maxY - minY + padding * 2 + 24,
        }
      })
      .filter(Boolean)
  }, [parsedTableGroups, parsedTables, tablePositions])

  const relationLines = useMemo(() => {
    return parsedRelations
      .map((rel) => {
        const fromTable = parsedTables.find(
          (t) => t.name.toLowerCase() === rel.fromTable.toLowerCase()
        )
        const toTable = parsedTables.find(
          (t) => t.name.toLowerCase() === rel.toTable.toLowerCase()
        )

        if (!fromTable || !toTable) return null

        const fromPos = tablePositions[fromTable.name] || { x: 60, y: 60 }
        const toPos = tablePositions[toTable.name] || { x: 400, y: 60 }

        const fromColIdx = fromTable.columns.findIndex(
          (c) => c.name.toLowerCase() === rel.fromColumn.toLowerCase()
        )
        const toColIdx = toTable.columns.findIndex(
          (c) => c.name.toLowerCase() === rel.toColumn.toLowerCase()
        )

        const safeFromColIdx = fromColIdx >= 0 ? fromColIdx : 0
        const safeToColIdx = toColIdx >= 0 ? toColIdx : 0

        const fromY =
          fromPos.y + HEADER_HEIGHT + safeFromColIdx * ROW_HEIGHT + ROW_HEIGHT / 2
        const toY =
          toPos.y + HEADER_HEIGHT + safeToColIdx * ROW_HEIGHT + ROW_HEIGHT / 2

        const fromIsLeft =
          fromPos.x + TABLE_WIDTH / 2 < toPos.x + TABLE_WIDTH / 2

        const startX = fromIsLeft ? fromPos.x + TABLE_WIDTH : fromPos.x
        const startY = fromY

        const endX = fromIsLeft ? toPos.x : toPos.x + TABLE_WIDTH
        const endY = toY

        const relKey = `${rel.fromTable.toLowerCase()}.${rel.fromColumn.toLowerCase()}->${rel.toTable.toLowerCase()}.${rel.toColumn.toLowerCase()}`

        const customJoints = edgeJoints[relKey]
        const defaultGeometry = computeCleanedOrthogonalPointsWithSegments(
          startX,
          startY,
          endX,
          endY,
          fromIsLeft,
          []
        )
        const interiorJoints = customJoints ?? getDefaultEdgeJoints(defaultGeometry.cleaned)
        const { cleaned } =
          customJoints === undefined
            ? defaultGeometry
            : computeCleanedOrthogonalPointsWithSegments(
                startX,
                startY,
                endX,
                endY,
                fromIsLeft,
                customJoints
              )
        const joints = [
          { x: startX, y: startY },
          ...interiorJoints,
          { x: endX, y: endY },
        ]
        const ghostCandidates = getGhostJointCandidates(cleaned, joints)

        const pathData = generateRoundedOrthogonalPathFromPoints(cleaned, 8)

        const isHovered =
          hoveredRelation === relKey ||
          hoveredTable === fromTable.name ||
          hoveredTable === toTable.name ||
          (hoveredField?.table.toLowerCase() === fromTable.name.toLowerCase() &&
            hoveredField?.column.toLowerCase() ===
              rel.fromColumn.toLowerCase()) ||
          (hoveredField?.table.toLowerCase() === toTable.name.toLowerCase() &&
            hoveredField?.column.toLowerCase() === rel.toColumn.toLowerCase())

        const isSelected =
          selectedRelation === relKey ||
          selectedTable === fromTable.name ||
          selectedTable === toTable.name ||
          (selectedField?.table.toLowerCase() === fromTable.name.toLowerCase() &&
            selectedField?.column.toLowerCase() ===
              rel.fromColumn.toLowerCase()) ||
          (selectedField?.table.toLowerCase() === toTable.name.toLowerCase() &&
            selectedField?.column.toLowerCase() === rel.toColumn.toLowerCase())

        const isActive = isHovered || isSelected

        const isDirectlyActive =
          selectedRelation === relKey ||
          draggingJoint?.relKey === relKey

        return {
          id: relKey,
          path: pathData,
          startX,
          startY,
          endX,
          endY,
          joints,
          interiorJoints,
          ghostCandidates,
          fromIsLeft,
          fromTable: rel.fromTable,
          fromColumn: rel.fromColumn,
          toTable: rel.toTable,
          toColumn: rel.toColumn,
          relType: rel.relType,
          isHovered,
          isSelected,
          isActive,
          isDirectlyActive,
        }
      })
      .filter(Boolean)
  }, [
    parsedRelations,
    parsedTables,
    tablePositions,
    edgeJoints,
    draggingJoint?.relKey,
    hoveredRelation,
    hoveredTable,
    hoveredField,
    selectedRelation,
    selectedTable,
    selectedField,
  ])

  const handleResetView = () => {
    zoomRef.current = 1
    panRef.current = { x: 60, y: 60 }
    setZoom(1)
    setPan({ x: 60, y: 60 })
  }

  const handleZoomIn = () => {
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    const currentZoom = zoomRef.current
    const currentPan = panRef.current
    const newZoom = Math.min(currentZoom * 1.15, 3)

    const worldX = (centerX - currentPan.x) / currentZoom
    const worldY = (centerY - currentPan.y) / currentZoom

    const newPanX = centerX - worldX * newZoom
    const newPanY = centerY - worldY * newZoom

    zoomRef.current = newZoom
    panRef.current = { x: newPanX, y: newPanY }
    setZoom(newZoom)
    setPan({ x: newPanX, y: newPanY })
  }

  const handleZoomOut = () => {
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    const currentZoom = zoomRef.current
    const currentPan = panRef.current
    const newZoom = Math.max(currentZoom * 0.85, 0.2)

    const worldX = (centerX - currentPan.x) / currentZoom
    const worldY = (centerY - currentPan.y) / currentZoom

    const newPanX = centerX - worldX * newZoom
    const newPanY = centerY - worldY * newZoom

    zoomRef.current = newZoom
    panRef.current = { x: newPanX, y: newPanY }
    setZoom(newZoom)
    setPan({ x: newPanX, y: newPanY })
  }

  return (
    <div className='relative flex h-full w-full flex-col overflow-hidden bg-muted/15 select-none'>
      <style>{`
        @keyframes dbmlMarchingDots {
          from {
            stroke-dashoffset: 24;
          }
          to {
            stroke-dashoffset: 0;
          }
        }
        .dbml-dotted-active {
          stroke-dasharray: 2 6;
          animation: dbmlMarchingDots 0.9s linear infinite;
        }
        @keyframes dbmlPulseRing {
          0% {
            r: 4px;
            opacity: 0.8;
          }
          100% {
            r: 10px;
            opacity: 0;
          }
        }
        .dbml-socket-pulse {
          animation: dbmlPulseRing 1.2s cubic-bezier(0.24, 0, 0.38, 1) infinite;
        }
      `}</style>

      <div className='absolute top-3 right-3 z-30 flex items-center gap-1.5 rounded-lg border border-border/80 bg-background/95 p-1 shadow-md backdrop-blur-md'>
        <Button
          variant='ghost'
          size='sm'
          className='h-7 gap-1 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground'
          onClick={handleApplyAutoLayout}
          title='Auto Layout Schema (Reorganize cleanly)'
        >
          <Sparkles className='size-3.5 text-emerald-500' />
          <span>Auto Layout</span>
        </Button>
        <div className='h-4 w-px bg-border/60 mx-0.5' />
        <Button
          variant='ghost'
          size='icon'
          className='size-7'
          onClick={handleZoomIn}
          title='Zoom in'
        >
          <ZoomIn className='size-3.5' />
        </Button>
        <span className='px-1 font-mono text-[10px] font-semibold text-muted-foreground min-w-10 text-center'>
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant='ghost'
          size='icon'
          className='size-7'
          onClick={handleZoomOut}
          title='Zoom out'
        >
          <ZoomOut className='size-3.5' />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='size-7'
          onClick={handleResetView}
          title='Reset zoom & pan'
        >
          <RotateCcw className='size-3.5' />
        </Button>
      </div>

      <div
        ref={viewportRef}
        onMouseDown={handleMouseDownBackground}
        onClick={() => {
          setSelectedTable(null)
          setSelectedField(null)
          setSelectedRelation(null)
        }}
        className={`relative flex-1 overflow-hidden ${
          canvasPanning ? 'cursor-grabbing' : 'cursor-default'
        }`}
      >
        {parsedTables.length === 0 ? (
          <div className='flex h-full min-h-[300px] flex-col items-center justify-center text-xs text-muted-foreground'>
            <Layers className='size-8 opacity-30 mb-2' />
            <p>No valid DBML table definitions found in schema code.</p>
          </div>
        ) : (
          <div
            className='absolute inset-0 size-full overflow-visible'
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
          >
            {renderedGroups.map((grp) => {
              if (!grp) return null
              return (
                <div
                  key={grp.name}
                  style={{
                    position: 'absolute',
                    left: `${grp.x}px`,
                    top: `${grp.y}px`,
                    width: `${grp.width}px`,
                    height: `${grp.height}px`,
                    borderColor: grp.color ? `${grp.color}66` : undefined,
                    backgroundColor: grp.color ? `${grp.color}0d` : undefined,
                  }}
                  className={`pointer-events-none z-10 rounded-2xl border-2 border-dashed p-3 ${
                    grp.color ? '' : 'border-emerald-500/30 bg-emerald-500/[0.03]'
                  }`}
                >
                  <div
                    style={{ color: grp.color || undefined }}
                    className={`flex items-center gap-1.5 text-xs font-bold ${
                      grp.color ? '' : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    <Layers className='size-3.5' />
                    <span className='font-mono uppercase tracking-wider text-[11px]'>
                      {grp.name}
                    </span>
                  </div>
                </div>
              )
            })}

            <svg
              className='pointer-events-none absolute inset-0 size-full overflow-visible z-20'
              xmlns='http://www.w3.org/2000/svg'
            >
              <defs>
                <filter id='dbmlGlow' x='-20%' y='-20%' width='140%' height='140%'>
                  <feGaussianBlur stdDeviation='1.5' result='blur' />
                  <feMerge>
                    <feMergeNode in='blur' />
                    <feMergeNode in='SourceGraphic' />
                  </feMerge>
                </filter>
              </defs>

              {relationLines.map((line) => {
                if (!line) return null

                const hasGhostOnThisLine =
                  ghostJoint && ghostJoint.relKey === line.id && !draggingJoint
                const lineCursorClass = hasGhostOnThisLine
                  ? ghostJoint.axis === 'x'
                    ? 'cursor-ew-resize'
                    : 'cursor-ns-resize'
                  : 'cursor-pointer'

                return (
                  <g
                    key={line.id}
                    onMouseEnter={() => setHoveredRelation(line.id)}
                    onMouseMove={(e) =>
                      line.isDirectlyActive &&
                      handleRelationMouseMove(
                        e,
                        line.id,
                        line.ghostCandidates
                      )
                    }
                    onMouseLeave={() => {
                      setHoveredRelation(null)
                      setGhostJoint((g) => (g?.relKey === line.id ? null : g))
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      if (hasGhostOnThisLine && ghostJoint) {
                        handleGhostJointMouseDown(
                          e,
                          ghostJoint,
                          line.interiorJoints
                        )
                        return
                      }
                      setSelectedRelation(line.id)
                      setSelectedTable(null)
                      setSelectedField(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className={`pointer-events-auto transition-all duration-150 ${lineCursorClass}`}
                  >
                    <path
                      d={line.path}
                      fill='none'
                      stroke='transparent'
                      strokeWidth={18}
                      className={lineCursorClass}
                    />

                    <path
                      d={line.path}
                      fill='none'
                      stroke={line.isActive ? '#10b981' : 'currentColor'}
                      strokeOpacity={line.isActive ? 0.35 : 1}
                      strokeWidth={line.isActive ? 1.5 : 1.25}
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      className={
                        line.isActive
                          ? 'text-emerald-500 transition-colors pointer-events-none'
                          : 'text-muted-foreground/45 transition-colors pointer-events-none'
                      }
                    />

                    {line.isActive && (
                      <path
                        d={line.path}
                        fill='none'
                        stroke='#10b981'
                        strokeWidth={1.75}
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        className='dbml-dotted-active pointer-events-none'
                        filter='url(#dbmlGlow)'
                      />
                    )}

                    <text
                      x={line.startX + (line.startX < line.endX ? 8 : -8)}
                      y={line.startY - 5}
                      textAnchor={line.startX < line.endX ? 'start' : 'end'}
                      className={`font-mono text-[9px] font-bold pointer-events-none ${
                        line.isActive
                          ? 'fill-emerald-500'
                          : 'fill-muted-foreground/80'
                      }`}
                    >
                      {line.relType === '>' ? 'N' : '1'}
                    </text>

                    <text
                      x={line.endX + (line.startX < line.endX ? -8 : 8)}
                      y={line.endY - 5}
                      textAnchor={line.startX < line.endX ? 'end' : 'start'}
                      className={`font-mono text-[9px] font-bold pointer-events-none ${
                        line.isActive
                          ? 'fill-emerald-500'
                          : 'fill-muted-foreground/80'
                      }`}
                    >
                      1
                    </text>

                    {line.isDirectlyActive &&
                      line.joints.map((joint, jIdx) => {
                        const isEndpoint = jIdx === 0 || jIdx === line.joints.length - 1
                        const interiorIndex = jIdx - 1
                        const isThisJointDragging =
                          !isEndpoint &&
                          draggingJoint?.relKey === line.id &&
                          draggingJoint?.jointIndex === interiorIndex
                        const axis = joint.axis || 'x'
                        const cursorClass = isEndpoint
                          ? 'pointer-events-none'
                          : axis === 'x'
                            ? 'cursor-ew-resize active:cursor-ew-resize'
                            : 'cursor-ns-resize active:cursor-ns-resize'

                        return (
                          <g
                            key={`${line.id}-joint-${jIdx}`}
                            onMouseDown={
                              isEndpoint
                                ? undefined
                                : (e) =>
                                    handleJointMouseDown(
                                      e,
                                      line.id,
                                      interiorIndex,
                                      line.interiorJoints
                                    )
                            }
                            onDoubleClick={
                              isEndpoint
                                ? undefined
                                : (e) =>
                                    handleJointDoubleClick(
                                      e,
                                      line.id,
                                      interiorIndex,
                                      line.interiorJoints
                                    )
                            }
                            className={cursorClass}
                          >
                            <circle
                              cx={joint.x}
                              cy={joint.y}
                              r={14}
                              fill='transparent'
                              className={cursorClass}
                            />

                            <circle
                              cx={joint.x}
                              cy={joint.y}
                              r={isThisJointDragging ? 8 : 6}
                              fill='#10b981'
                              fillOpacity={0.25}
                              className='animate-pulse pointer-events-none'
                            />

                            <circle
                              cx={joint.x}
                              cy={joint.y}
                              r={isThisJointDragging ? 5 : 4}
                              fill={isThisJointDragging ? '#34d399' : '#10b981'}
                              stroke='#09090b'
                              strokeWidth={1.5}
                              className='transition-all hover:scale-125 pointer-events-none'
                            />
                            <circle
                              cx={joint.x}
                              cy={joint.y}
                              r={isThisJointDragging ? 2 : 1.5}
                              fill='#ffffff'
                              className='pointer-events-none'
                            />
                          </g>
                        )
                      })}

                    {hasGhostOnThisLine && ghostJoint && (
                      <g className='pointer-events-none'>
                        <circle
                          cx={ghostJoint.x}
                          cy={ghostJoint.y}
                          r={6}
                          fill='#10b981'
                          fillOpacity={0.25}
                          className='pointer-events-none'
                        />
                        <circle
                          cx={ghostJoint.x}
                          cy={ghostJoint.y}
                          r={4}
                          fill='#10b981'
                          stroke='#09090b'
                          strokeWidth={1.5}
                          strokeDasharray='2 2'
                          className='pointer-events-none'
                        />
                        <circle
                          cx={ghostJoint.x}
                          cy={ghostJoint.y}
                          r={1.5}
                          fill='#ffffff'
                          className='pointer-events-none'
                        />
                      </g>
                    )}

                    {line.isDirectlyActive && line.joints.length > 7 && (
                      <foreignObject
                        x={
                          (line.joints[Math.floor(line.joints.length / 2)]?.x ??
                            Math.round((line.startX + line.endX) / 2)) - 54
                        }
                        y={
                          (line.joints[Math.floor(line.joints.length / 2)]?.y ??
                            Math.round((line.startY + line.endY) / 2)) - 36
                        }
                        width={108}
                        height={32}
                        className='overflow-visible pointer-events-auto'
                      >
                        <button
                          type='button'
                          onClick={(e) => handleResetEdgeJoints(e, line.id)}
                          className='flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background/95 hover:bg-destructive hover:text-destructive-foreground text-foreground border border-border shadow-lg text-[10px] font-semibold transition-all duration-150 backdrop-blur-md cursor-pointer select-none'
                          title='Reset joints to default effective edge'
                        >
                          <RotateCcw className='h-3 w-3 shrink-0' />
                          <span>Reset Edge</span>
                        </button>
                      </foreignObject>
                    )}
                  </g>
                )
              })}
            </svg>

            {parsedTables.map((table) => {
              const pos = tablePositions[table.name] || { x: 60, y: 60 }
              const isSelected = selectedTable === table.name
              const isHovered = hoveredTable === table.name

              return (
                <div
                  key={table.name}
                  style={{
                    position: 'absolute',
                    left: `${pos.x}px`,
                    top: `${pos.y}px`,
                    width: `${TABLE_WIDTH}px`,
                    borderColor:
                      !isSelected && !isHovered && table.headerColor
                        ? `${table.headerColor}40`
                        : undefined,
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedTable(table.name)
                    setSelectedRelation(null)
                    setSelectedField(null)
                  }}
                  onMouseDown={(e) => handleMouseDownTable(table.name, e)}
                  onMouseEnter={() => setHoveredTable(table.name)}
                  onMouseLeave={() => setHoveredTable(null)}
                  className={`z-30 flex flex-col rounded-xl border bg-card shadow-sm transition-all cursor-grab active:cursor-grabbing ${
                    isSelected
                      ? 'border-emerald-500 ring-1 ring-emerald-500/30 shadow-md'
                      : isHovered
                      ? 'border-emerald-500/60 shadow-sm'
                      : 'border-border/80 hover:border-border hover:shadow-md'
                  }`}
                >
                  <div
                    style={
                      table.headerColor
                        ? { backgroundColor: table.headerColor }
                        : undefined
                    }
                    className={`flex items-center justify-between border-b px-3 py-2.5 transition-colors rounded-t-[11px] ${
                      table.headerColor
                        ? 'border-black/15 text-white'
                        : 'border-border/80 bg-muted/60 text-foreground'
                    }`}
                  >
                    <div className='flex items-center gap-1.5 min-w-0'>
                      <span
                        className={`font-mono text-xs font-bold truncate ${
                          table.headerColor ? 'text-white' : 'text-foreground'
                        }`}
                      >
                        {table.name}
                      </span>
                      {table.alias && (
                        <span
                          className={`text-[10px] font-mono font-normal ${
                            table.headerColor
                              ? 'text-white/80'
                              : 'text-muted-foreground'
                          }`}
                        >
                          as {table.alias}
                        </span>
                      )}
                    </div>
                    <Badge
                      variant='outline'
                      className={`text-[10px] font-mono px-1.5 py-0 shrink-0 ${
                        table.headerColor
                          ? 'bg-black/25 text-white border-white/25 shadow-xs'
                          : 'bg-background/80'
                      }`}
                    >
                      {table.columns.length} cols
                    </Badge>
                  </div>

                  <div
                    className={`divide-y divide-border/40 p-1 bg-background ${
                      table.indexes.length > 0 ? '' : 'rounded-b-[11px]'
                    }`}
                  >
                    {table.columns.map((col) => {
                      const isFieldSelected =
                        selectedField?.table.toLowerCase() ===
                          table.name.toLowerCase() &&
                        selectedField?.column.toLowerCase() ===
                          col.name.toLowerCase()

                      const isFieldHovered =
                        (hoveredField?.table.toLowerCase() ===
                          table.name.toLowerCase() &&
                          hoveredField?.column.toLowerCase() ===
                            col.name.toLowerCase()) ||
                        (hoveredRelation &&
                          hoveredRelation.includes(
                            `${table.name}.${col.name}`
                          ))

                      const isFieldRelated =
                        Boolean(
                          selectedRelation &&
                            selectedRelation.includes(`${table.name}.${col.name}`)
                        )

                      const isFieldActive =
                        isFieldSelected || isFieldHovered || isFieldRelated

                      const hasRelation =
                        col.isFk ||
                        col.isPk ||
                        parsedRelations.some(
                          (r) =>
                            (r.fromTable.toLowerCase() ===
                              table.name.toLowerCase() &&
                              r.fromColumn.toLowerCase() ===
                                col.name.toLowerCase()) ||
                            (r.toTable.toLowerCase() ===
                              table.name.toLowerCase() &&
                              r.toColumn.toLowerCase() ===
                                col.name.toLowerCase())
                        )

                      return (
                        <div
                          key={col.name}
                          style={{ height: `${ROW_HEIGHT}px` }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedField({
                              table: table.name,
                              column: col.name,
                            })
                            setSelectedTable(table.name)
                            setSelectedRelation(null)
                          }}
                          onMouseEnter={(e) => {
                            e.stopPropagation()
                            setHoveredField({
                              table: table.name,
                              column: col.name,
                            })
                          }}
                          onMouseLeave={(e) => {
                            e.stopPropagation()
                            setHoveredField(null)
                          }}
                          className={`group relative flex items-center justify-between px-2.5 text-xs transition-colors rounded ${
                            isFieldActive
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium'
                              : 'hover:bg-muted/40 text-foreground'
                          }`}
                        >
                          <div
                            className={`absolute -left-[5px] top-1/2 -translate-y-1/2 size-2.5 rounded-full border-2 transition-all ${
                              isFieldActive
                                ? 'bg-emerald-500 border-background shadow-xs shadow-emerald-500 scale-110 ring-2 ring-emerald-500/30'
                                : hasRelation
                                ? 'bg-muted-foreground/40 border-card group-hover:bg-emerald-400 group-hover:scale-110'
                                : 'opacity-0 group-hover:opacity-100 bg-muted-foreground/30 border-card'
                            }`}
                            title={`Joint socket: ${table.name}.${col.name}`}
                          />

                          <div
                            className={`absolute -right-[5px] top-1/2 -translate-y-1/2 size-2.5 rounded-full border-2 transition-all ${
                              isFieldActive
                                ? 'bg-emerald-500 border-background shadow-xs shadow-emerald-500 scale-110 ring-2 ring-emerald-500/30'
                                : hasRelation
                                ? 'bg-muted-foreground/40 border-card group-hover:bg-emerald-400 group-hover:scale-110'
                                : 'opacity-0 group-hover:opacity-100 bg-muted-foreground/30 border-card'
                            }`}
                            title={`Joint socket: ${table.name}.${col.name}`}
                          />

                          <div className='flex items-center gap-2 min-w-0 flex-1'>
                            {col.isPk ? (
                              <Key className='size-3.5 shrink-0 text-amber-500' />
                            ) : col.isFk ? (
                              <Link2
                                className={`size-3.5 shrink-0 ${
                                  isFieldActive
                                    ? 'text-emerald-500'
                                    : 'text-blue-500'
                                }`}
                              />
                            ) : (
                              <div className='size-1.5 rounded-full bg-muted-foreground/30 ml-1' />
                            )}
                            <span className='font-mono text-xs truncate'>
                              {col.name}
                            </span>
                          </div>

                          <div className='flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground shrink-0'>
                            <span>{col.type}</span>
                            {col.isPk && (
                              <span className='rounded bg-amber-500/15 px-1 py-0.2 text-[9px] font-bold text-amber-600 dark:text-amber-400'>
                                PK
                              </span>
                            )}
                            {col.isFk && (
                              <span
                                className='flex items-center gap-0.5 rounded bg-blue-500/15 px-1.5 py-0.2 text-[9px] font-bold text-blue-600 dark:text-blue-400'
                                title={
                                  col.fkTarget
                                    ? `References ${col.fkTarget.table}.${col.fkTarget.column}`
                                    : 'Foreign Key'
                                }
                              >
                                <Link2 className='size-2.5' />
                                <span>FK</span>
                              </span>
                            )}
                            {col.isUnique && !col.isPk && (
                              <span className='rounded bg-purple-500/15 px-1 py-0.2 text-[9px] font-bold text-purple-600 dark:text-purple-400'>
                                UQ
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {table.indexes.length > 0 && (
                    <div className='border-t border-border/60 bg-muted/20 p-1 rounded-b-[11px]'>
                      <div className='px-2 py-1 text-[9px] font-bold tracking-wider uppercase text-muted-foreground'>
                        Indexes
                      </div>
                      <div className='space-y-0.5'>
                        {table.indexes.map((idx, i) => (
                          <div
                            key={i}
                            style={{ height: `${INDEX_ROW_HEIGHT}px` }}
                            className='flex items-center justify-between rounded px-2 text-[10px] font-mono hover:bg-muted/40'
                            title={
                              idx.name
                                ? `Index: ${idx.name}`
                                : `Index on (${idx.columns.join(', ')})`
                            }
                          >
                            <span className='truncate text-foreground/80 max-w-40'>
                              ({idx.columns.join(', ')})
                            </span>
                            <span
                              className={`rounded px-1 py-0.2 text-[8px] font-bold ${
                                idx.isUnique
                                  ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {idx.isUnique ? 'UNIQUE' : 'INDEX'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
