import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createCollabServer } from '../src/server'
import { seedSource, sourceToJSON } from '../src/source'
import { connect, FakeBackend, freePort, waitFor } from './support'

// What a DBML or Mermaid source costs: update and state sizes while typing, a
// Format as one replacement, the store derive, and a flush through a room.
// Run with COLLAB_LOAD=1; the numbers go into the pull request for #122.
const table = (i: number) =>
  `Table orders_${i} {\n  id int [pk, increment]\n  customer_id int [ref: > customers.id]\n  total decimal(10,2) [not null]\n  status varchar(32) [note: 'pending, paid, shipped']\n  created_at timestamp [default: \`now()\`]\n}\n\n`
const sources = {
  representative: Array.from({ length: 12 }, (_, i) => table(i)).join(''),
  large: Array.from({ length: 1200 }, (_, i) => table(i)).join(''),
}
const workspace = '11111111-1111-4111-8111-111111111111'
const document = '44444444-4444-4444-8444-444444444444'
const record = '66666666-6666-4666-8666-666666666666'

const time = (runs: number, f: () => void) => {
  const t = performance.now()
  for (let i = 0; i < runs; i++) f()
  return (performance.now() - t) / runs
}

describe.runIf(process.env.COLLAB_LOAD)('a DBML or Mermaid source under load', () => {
  for (const [name, source] of Object.entries(sources)) {
    it(`measures a ${name} source`, () => {
      const doc = new Y.Doc()
      Y.applyUpdate(doc, seedSource({ source }))
      const text = doc.getText('source')
      const updates: number[] = []
      doc.on('update', (update: Uint8Array) => updates.push(update.length))
      // 2000 keystrokes spread through the source, as one person typing.
      for (let i = 0; i < 2000; i++) text.insert((i * 7919) % text.length, 'x')
      const keystrokeBytes = updates.reduce((a, b) => a + b, 0) / updates.length
      updates.length = 0
      // A Format rewrites every line's indentation in one transaction.
      const formatted = text.toString().replace(/^ {2}/gm, '    ')
      doc.transact(() => {
        text.delete(0, text.length)
        text.insert(0, formatted)
      })
      const result = {
        sourceKB: +(source.length / 1024).toFixed(1),
        keystrokeUpdateBytes: +keystrokeBytes.toFixed(1),
        formatUpdateKB: +((updates[0] ?? 0) / 1024).toFixed(1),
        stateKBAfterEdits: +(Y.encodeStateAsUpdate(doc).length / 1024).toFixed(1),
        deriveOnStoreMs: +time(50, () => sourceToJSON(doc)).toFixed(3),
        encodeStateMs: +time(20, () => Y.encodeStateAsUpdate(doc)).toFixed(2),
      }
      console.log(name, JSON.stringify(result))
      expect(text.toString()).toBe(formatted)
    })
  }

  it('measures a flush through a room and memory over open, edit and close cycles', async () => {
    const backend = new FakeBackend()
    backend.grant('tok-a', 'user-a', { documentType: 'dbdiagram' })
    backend.replacements.set(document, record)
    backend.documents.set(document, { state: null, content: { source: sources.large } })
    const port = await freePort()
    const server = await createCollabServer({ backend, port, debounceMs: 60_000, maxDebounceMs: 60_000 })
    const flushes: number[] = []
    global.gc?.()
    const heapBefore = process.memoryUsage().heapUsed
    for (let cycle = 0; cycle < 10; cycle++) {
      const a = connect(port, `${workspace}.${document}.${record}`, 'tok-a')
      await a.synced
      a.doc.getText('source').insert(0, `// cycle ${cycle}\n`)
      const id = `f${cycle}`
      const started = performance.now()
      a.provider.sendStateless(JSON.stringify({ type: 'flush', id }))
      await waitFor(() => a.statelessMessages.some((m: any) => m.type === 'stored' && m.id === id), 10_000)
      flushes.push(performance.now() - started)
      a.provider.destroy()
      a.doc.destroy()
      // The room unloads once its last editor left and it was stored.
      await waitFor(() => true)
    }
    await server.stop()
    global.gc?.()
    const result = {
      flushToStoredMsMedian: +(flushes.sort((x, y) => x - y)[Math.floor(flushes.length / 2)] ?? 0).toFixed(1),
      flushToStoredMsMax: +Math.max(...flushes).toFixed(1),
      storedSourceKB: +((backend.stores.at(-1)?.markdown.length ?? 0) / 1024).toFixed(1),
      heapGrowthMBAfter10Cycles: +((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024).toFixed(1),
    }
    console.log('room', JSON.stringify(result))
    expect(backend.stores.at(-1)?.markdown.startsWith('// cycle 9\n')).toBe(true)
  })
})
