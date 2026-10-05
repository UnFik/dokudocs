// The editor's schema is shared from the frontend source, which would load its
// own prosemirror-model. Two copies cannot read each other's nodes, so every
// import of it is sent to the one this service installs.
import { register } from 'node:module'
register('./single-copy-hooks.mjs', import.meta.url)
