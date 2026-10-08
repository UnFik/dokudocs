/** How wide each side panel of the canvas may be, in pixels. */
export const panelWidths = {
  palette: { default: 216, min: 180, max: 360 },
  props: { default: 280, min: 240, max: 480 },
} as const

export type SidePanel = keyof typeof panelWidths

/** A width within the panel's range; anything that is not a number is its default. */
export function panelWidth(panel: SidePanel, value: unknown): number {
  const range = panelWidths[panel]
  if (typeof value !== 'number' || !Number.isFinite(value)) return range.default
  return Math.round(Math.min(range.max, Math.max(range.min, value)))
}
