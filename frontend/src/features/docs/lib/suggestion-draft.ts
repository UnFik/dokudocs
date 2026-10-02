import type {
  SuggestionDraft,
  SuggestionOperation,
} from './suggestion-operations'

export type DiffSegment = { kind: 'keep' | 'delete' | 'insert'; text: string }

// Above this many cells the middle of a change is shown as one delete plus one
// insert instead of a character diff.
const maxDiffCells = 250_000

/** Splits a run's change into kept, deleted, and inserted text, in base order. */
export function diffText(base: string, text: string): DiffSegment[] {
  let start = 0
  while (
    start < base.length &&
    start < text.length &&
    base[start] === text[start]
  )
    start++
  let end = 0
  while (
    end < base.length - start &&
    end < text.length - start &&
    base[base.length - 1 - end] === text[text.length - 1 - end]
  )
    end++
  const segments: DiffSegment[] = []
  const push = (kind: DiffSegment['kind'], value: string) => {
    if (!value) return
    const last = segments[segments.length - 1]
    if (last?.kind === kind) last.text += value
    else segments.push({ kind, text: value })
  }
  push('keep', base.slice(0, start))
  const removed = base.slice(start, base.length - end)
  const added = text.slice(start, text.length - end)
  if (removed && added && removed.length * added.length <= maxDiffCells)
    for (const segment of diffMiddle(removed, added))
      push(segment.kind, segment.text)
  else {
    push('delete', removed)
    push('insert', added)
  }
  push('keep', base.slice(base.length - end))
  return segments
}

// Longest common subsequence; deletions are emitted before insertions so a
// replacement reads as struck text followed by the new text.
function diffMiddle(removed: string, added: string): DiffSegment[] {
  const rows = removed.length + 1
  const cols = added.length + 1
  const table = new Uint32Array(rows * cols)
  for (let i = removed.length - 1; i >= 0; i--)
    for (let j = added.length - 1; j >= 0; j--)
      table[i * cols + j] =
        removed[i] === added[j]
          ? table[(i + 1) * cols + j + 1]! + 1
          : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!)
  const segments: DiffSegment[] = []
  const push = (kind: DiffSegment['kind'], value: string) => {
    const last = segments[segments.length - 1]
    if (last?.kind === kind) last.text += value
    else segments.push({ kind, text: value })
  }
  let i = 0
  let j = 0
  while (i < removed.length && j < added.length) {
    if (removed[i] === added[j]) {
      push('keep', removed[i]!)
      i++
      j++
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) {
      push('delete', removed[i]!)
      i++
    } else {
      push('insert', added[j]!)
      j++
    }
  }
  if (i < removed.length) push('delete', removed.slice(i))
  if (j < added.length) push('insert', added.slice(j))
  return segments
}

/** Where a caret at `baseOffset` lands in the suggested text: after any text inserted there. */
export function draftOffsetForBase(
  base: string,
  text: string,
  baseOffset: number
) {
  let baseAt = 0
  let draftAt = 0
  for (const segment of diffText(base, text)) {
    const length = segment.text.length
    if (segment.kind === 'insert') {
      if (baseAt <= baseOffset) draftAt += length
      continue
    }
    if (baseAt + length > baseOffset) {
      return segment.kind === 'keep' ? draftAt + (baseOffset - baseAt) : draftAt
    }
    baseAt += length
    if (segment.kind === 'keep') draftAt += length
  }
  return draftAt
}

/** The base position that shows a caret at `draftOffset`; inserted text maps to its insertion point. */
export function baseOffsetForDraft(
  base: string,
  text: string,
  draftOffset: number
) {
  let baseAt = 0
  let draftAt = 0
  for (const segment of diffText(base, text)) {
    const length = segment.text.length
    if (segment.kind === 'delete') {
      // A caret before struck text sits in front of it, not after.
      if (draftAt === draftOffset) return baseAt
      baseAt += length
      continue
    }
    if (segment.kind === 'insert') {
      if (draftAt + length >= draftOffset) return baseAt
      draftAt += length
      continue
    }
    if (draftAt + length >= draftOffset) return baseAt + (draftOffset - draftAt)
    baseAt += length
    draftAt += length
  }
  return baseAt
}

/** Whether a caret at `baseOffset` sits inside or at the edge of a change. */
export function touchesChange(base: string, text: string, baseOffset: number) {
  let baseAt = 0
  for (const segment of diffText(base, text)) {
    const end = baseAt + (segment.kind === 'insert' ? 0 : segment.text.length)
    if (segment.kind !== 'keep' && baseAt <= baseOffset && baseOffset <= end)
      return true
    baseAt = end
  }
  return false
}

export type RunDraft = { nodeID: string; base: string; text: string }

export type DraftCaret = { nodeID: string; offset: number }

/** The suggestion being typed: every run of one block, with the caret in suggested-text offsets. */
export type TypingDraft = {
  suggestionID: string
  blockID: string
  runs: RunDraft[]
  caret: DraftCaret
  /** Own pending suggestions this draft supersedes; they are withdrawn once it is saved. */
  replaces: string[]
}

function runIndex(draft: TypingDraft, nodeID: string) {
  const index = draft.runs.findIndex((run) => run.nodeID === nodeID)
  if (index < 0) throw new Error(`run ${nodeID} is not in this block`)
  return index
}

function withRun(draft: TypingDraft, index: number, text: string): TypingDraft {
  const runs = draft.runs.slice()
  runs[index] = { ...runs[index]!, text }
  return { ...draft, runs }
}

// One user-visible character: a surrogate pair counts as one.
function charBefore(text: string, offset: number) {
  const low = text.charCodeAt(offset - 1)
  const high = text.charCodeAt(offset - 2)
  return low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff
    ? 2
    : 1
}

function charAfter(text: string, offset: number) {
  const high = text.charCodeAt(offset)
  const low = text.charCodeAt(offset + 1)
  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff
    ? 2
    : 1
}

export function insertDraftText(
  draft: TypingDraft,
  value: string
): TypingDraft {
  const index = runIndex(draft, draft.caret.nodeID)
  const run = draft.runs[index]!
  const offset = draft.caret.offset
  return {
    ...withRun(
      draft,
      index,
      run.text.slice(0, offset) + value + run.text.slice(offset)
    ),
    caret: { nodeID: run.nodeID, offset: offset + value.length },
  }
}

/** Removes the character before the caret, crossing into earlier runs of the block; null at the block start. */
export function deleteDraftBackward(draft: TypingDraft): TypingDraft | null {
  let index = runIndex(draft, draft.caret.nodeID)
  let offset = draft.caret.offset
  while (offset === 0) {
    if (index === 0) return null
    index--
    offset = draft.runs[index]!.text.length
  }
  const run = draft.runs[index]!
  const width = charBefore(run.text, offset)
  return {
    ...withRun(
      draft,
      index,
      run.text.slice(0, offset - width) + run.text.slice(offset)
    ),
    caret: { nodeID: run.nodeID, offset: offset - width },
  }
}

/** Removes the character after the caret, crossing into later runs; null at the block end. */
export function deleteDraftForward(draft: TypingDraft): TypingDraft | null {
  let index = runIndex(draft, draft.caret.nodeID)
  let offset = draft.caret.offset
  while (offset === draft.runs[index]!.text.length) {
    if (index === draft.runs.length - 1) return null
    index++
    offset = 0
  }
  const run = draft.runs[index]!
  const width = charAfter(run.text, offset)
  return {
    ...withRun(
      draft,
      index,
      run.text.slice(0, offset) + run.text.slice(offset + width)
    ),
    caret: { nodeID: run.nodeID, offset },
  }
}

/** Removes suggested text between two carets of the same block and leaves the caret at the start. */
export function deleteDraftRange(
  draft: TypingDraft,
  from: DraftCaret,
  to: DraftCaret
): TypingDraft {
  let start = runIndex(draft, from.nodeID)
  let end = runIndex(draft, to.nodeID)
  let fromOffset = from.offset
  let toOffset = to.offset
  if (start > end || (start === end && fromOffset > toOffset)) {
    ;[start, end] = [end, start]
    ;[fromOffset, toOffset] = [toOffset, fromOffset]
    from = to
  }
  const runs = draft.runs.map((run, index) => {
    if (index < start || index > end) return run
    const cutFrom = index === start ? fromOffset : 0
    const cutTo = index === end ? toOffset : run.text.length
    return {
      ...run,
      text: run.text.slice(0, cutFrom) + run.text.slice(cutTo),
    }
  })
  return { ...draft, runs, caret: { nodeID: from.nodeID, offset: fromOffset } }
}

export function draftHasChanges(draft: TypingDraft) {
  return draft.runs.some((run) => run.text !== run.base)
}

function clip(text: string) {
  return text.slice(0, 80)
}

/**
 * The stored form of a typed draft. Each operation names the run text it was
 * typed against, so acceptance checks that run instead of the whole body.
 */
export function draftSuggestion(draft: TypingDraft): SuggestionDraft | null {
  const operations: SuggestionOperation[] = []
  let removed = ''
  let added = ''
  for (const run of draft.runs) {
    if (run.text === run.base) continue
    operations.push(
      run.text
        ? {
            op: 'replace_text',
            nodeID: run.nodeID,
            content: run.text,
            baseContent: run.base,
          }
        : { op: 'delete', nodeID: run.nodeID, baseContent: run.base }
    )
    for (const segment of diffText(run.base, run.text)) {
      if (segment.kind === 'delete') removed += segment.text
      if (segment.kind === 'insert') added += segment.text
    }
  }
  if (!operations.length) return null
  const summary =
    removed && added
      ? `Replace “${clip(removed)}” with “${clip(added)}”`
      : added
        ? `Insert “${clip(added)}”`
        : `Delete “${clip(removed)}”`
  return { operations, summary }
}

/** One run of a pending typed suggestion, as the editor draws it. */
export type TextLayerEntry = {
  suggestionID: string
  nodeID: string
  base: string
  text: string
  own: boolean
}

/** The pending suggestions that were typed against run text, one entry per run. */
export function textLayerEntries(
  suggestions: {
    suggestionId: string
    proposerId: string
    status: string
    operations: unknown
  }[],
  userID: string
): TextLayerEntry[] {
  const entries: TextLayerEntry[] = []
  for (const suggestion of suggestions) {
    if (
      suggestion.status !== 'pending' ||
      !Array.isArray(suggestion.operations)
    )
      continue
    const runs: TextLayerEntry[] = []
    for (const raw of suggestion.operations as unknown[]) {
      const operation = typedTextOperation(raw)
      if (!operation) {
        runs.length = 0
        break
      }
      runs.push({
        suggestionID: suggestion.suggestionId,
        nodeID: operation.nodeID,
        base: operation.baseContent,
        text: operation.content,
        own: suggestion.proposerId === userID,
      })
    }
    entries.push(...runs)
  }
  return entries
}

export function typedTextOperation(
  raw: unknown
): { nodeID: string; baseContent: string; content: string } | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { op, nodeID, baseContent, content } = raw as Record<string, unknown>
  if (typeof nodeID !== 'string' || typeof baseContent !== 'string') return null
  if (op === 'replace_text' && typeof content === 'string')
    return { nodeID, baseContent, content }
  if (op === 'delete') return { nodeID, baseContent, content: '' }
  return null
}
