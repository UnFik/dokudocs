/** What a click or a drag on the canvas does. One tool is active at a time. */
export type CanvasTool = 'hand' | 'cursor' | 'eraser' | 'comment'

const keys: Record<string, CanvasTool> = {
  v: 'cursor',
  h: 'hand',
  e: 'eraser',
  c: 'comment',
}

export const toolKeys: Record<CanvasTool, string> = {
  cursor: 'V',
  hand: 'H',
  eraser: 'E',
  comment: 'C',
}
export const lockKey = 'L'

export function toolForKey(key: string): CanvasTool | null {
  return keys[key.toLowerCase()] ?? null
}

/** The tool after one use: Eraser and Comment are one-shot. */
export function afterUse(tool: CanvasTool): CanvasTool {
  return tool === 'eraser' || tool === 'comment' ? 'cursor' : tool
}

/** The tools a person may use, in the order the tool bar shows them. */
export function toolsFor(access: {
  canEdit: boolean
  canComment: boolean
}): CanvasTool[] {
  return (['hand', 'cursor', 'eraser', 'comment'] as const).filter(
    (tool) =>
      (tool !== 'eraser' || access.canEdit) &&
      (tool !== 'comment' || access.canComment)
  )
}
