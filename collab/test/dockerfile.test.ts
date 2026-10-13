import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const withExtension = (path: string) => (existsSync(`${path}.ts`) ? `${path}.ts` : path)

/** Every frontend file the service imports, directly or through another frontend file. */
function frontendFilesUsed(): string[] {
  const seen = new Set<string>()
  const visit = (file: string) => {
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/from '(\.[^']+)'/g)) {
      const target = withExtension(resolve(dirname(file), spec!))
      if (!target.startsWith(join(root, 'frontend')) || seen.has(target)) continue
      seen.add(target)
      visit(target)
    }
  }
  const src = join(root, 'collab/src')
  for (const name of readdirSync(src).filter((n) => n.endsWith('.ts'))) visit(join(src, name))
  return [...seen]
}

describe('the collaboration image', () => {
  it('carries every frontend file the service imports', () => {
    const copied = readFileSync(join(root, 'collab/Dockerfile'), 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('COPY frontend/'))
      .map((line) => join(root, line.split(' ')[1]!))
    const missing = frontendFilesUsed().filter((file) => !copied.includes(file))
    expect(missing.map((file) => file.slice(root.length + 1))).toEqual([])
  })
})
