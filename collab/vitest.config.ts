import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const modules = (path: string) => fileURLToPath(new URL(`./node_modules/${path}`, import.meta.url))

export default defineConfig({
  resolve: {
    // The editor's schema is imported from the frontend source, which has its own
    // node_modules: point its library at this copy's ESM entry, the one the other
    // packages load, so there is one instance of it (instanceof must hold).
    alias: { 'prosemirror-model': modules('prosemirror-model/dist/index.js') },
  },
  test: { include: ['test/**/*.test.ts'], testTimeout: 15000 },
})
