import { pathToFileURL } from 'node:url'

const entry = pathToFileURL(new URL('./node_modules/prosemirror-model/dist/index.js', import.meta.url).pathname).href

export async function resolve(specifier, context, next) {
  if (specifier === 'prosemirror-model') return { url: entry, shortCircuit: true }
  return next(specifier, context)
}
