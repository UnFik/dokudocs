import { describe, expect, it, vi } from 'vitest'
import mermaid from 'mermaid'
import { MarkerSeverity, validateDbml, validateMermaid } from './monaco-diagnostics'

describe('Monaco DBML Diagnostics', () => {
  it('passes on valid DBML schema', () => {
    const validDbml = `
Table users {
  id integer [primary key]
  username varchar
  role varchar
  created_at timestamp
}

Table posts {
  id integer [primary key]
  title varchar
  user_id integer [not null]
}

Ref: posts.user_id > users.id
`
    const markers = validateDbml(validDbml)
    const errors = markers.filter((m) => m.severity === MarkerSeverity.Error)
    expect(errors.length).toBe(0)
  })

  it('detects unclosed braces', () => {
    const brokenDbml = `
Table users {
  id integer [pk]
  username varchar
`
    const markers = validateDbml(brokenDbml)
    expect(markers.some((m) => m.message.includes("missing '}'"))).toBe(true)
  })

  it('detects duplicate tables', () => {
    const dupDbml = `
Table users {
  id integer [pk]
}

Table users {
  id integer [pk]
}
`
    const markers = validateDbml(dupDbml)
    expect(markers.some((m) => m.message.includes("Duplicate table definition 'users'"))).toBe(true)
  })

  it('detects invalid Ref syntax', () => {
    const invalidRef = `
Table users {
  id integer [pk]
}

Ref: users.id >
`
    const markers = validateDbml(invalidRef)
    expect(markers.some((m) => m.message.includes('Invalid Ref syntax'))).toBe(true)
  })

  it('warns on references to non-existent tables', () => {
    const missingRef = `
Table posts {
  id integer [pk]
  user_id integer
}

Ref: posts.user_id > non_existing_table.id
`
    const markers = validateDbml(missingRef)
    expect(markers.some((m) => m.message.includes("Referenced table 'non_existing_table' is not defined"))).toBe(true)
  })

  it('warns on references to non-existent columns', () => {
    const missingColRef = `
Table users {
  id integer [pk]
}

Table posts {
  id integer [pk]
  author_id integer
}

Ref: posts.non_existent_column > users.id
`
    const markers = validateDbml(missingColRef)
    expect(markers.some((m) => m.message.includes("Column 'non_existent_column' not found in table 'posts'"))).toBe(true)
  })
})

describe('Monaco Mermaid Diagnostics', () => {
  it('returns empty markers when parse succeeds', async () => {
    const spy = vi.spyOn(mermaid, 'parse').mockResolvedValueOnce({ diagramType: 'flowchart-v2' } as any)
    const markers = await validateMermaid('graph TD\n A-->B')
    expect(markers.length).toBe(0)
    spy.mockRestore()
  })

  it('returns formatted error marker when parse throws syntax error', async () => {
    const spy = vi.spyOn(mermaid, 'parse').mockRejectedValueOnce(
      new Error("Parse error on line 4:\n...A --->>> ???\nExpecting 'AMP', got 'TAGEND'")
    )
    const markers = await validateMermaid('graph TD\n    A[Start]\n    B[Process]\n    C --->>> ???')
    expect(markers.length).toBe(1)
    expect(markers[0].startLineNumber).toBe(4)
    expect(markers[0].severity).toBe(MarkerSeverity.Error)
    expect(markers[0].message).toContain("Expecting 'AMP'")
    spy.mockRestore()
  })
})
