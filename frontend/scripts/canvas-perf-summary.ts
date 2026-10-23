// Turns the JSON report of `bun run test:perf` into a Markdown table, for the
// CI job summary. Usage: bun scripts/canvas-perf-summary.ts perf-results.json
import { readFileSync } from 'node:fs'

type Row = {
  elements: number
  connections: number
  mountMs: number
  dragFps: number
  medianFrameMs: number
  worstFrameMs: number
}
type Report = {
  testResults: {
    assertionResults: { status: string; meta?: { canvasPerf?: Row } }[]
  }[]
}

const report = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Report
const rows = report.testResults
  .flatMap((file) => file.assertionResults)
  .flatMap((test) => (test.meta?.canvasPerf ? [test.meta.canvasPerf] : []))
  .sort((a, b) => a.elements - b.elements)

if (!rows.length) {
  process.stderr.write('No canvas performance results were recorded.\n')
  process.exit(1)
}
process.stdout.write(
  [
    '### Architecture canvas: dragging one System',
    '',
    '| Elements | Connections | Drag fps | Median frame | Worst frame | First draw |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(
      (r) =>
        `| ${r.elements} | ${r.connections} | ${r.dragFps} | ${r.medianFrameMs} ms | ${r.worstFrameMs} ms | ${r.mountMs} ms |`
    ),
    '',
    'Production React in headless Chromium on the CI runner; frame times are rounded to the display refresh, so fps steps (60, 30, 20 ...).',
  ].join('\n') + '\n'
)
