import type { PaletteItem } from '../lib/canvas-actions'

// The item being dragged from the palette. Browsers hide drag data until the drop,
// but the canvas needs it while the pointer moves to show the slot it will land in.
export const paletteDrag: { current: PaletteItem | null } = { current: null }
