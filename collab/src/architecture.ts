// The canvas model is shared with the editor, so the service reads and writes
// Architecture documents exactly as the editor does (as `schema.ts` does for Markdown).
export * from '../../frontend/src/features/architecture/lib/canvas-model'
export { architectureThumbnail } from '../../frontend/src/features/architecture/lib/architecture-thumbnail'
