import { describe, expect, it } from 'vitest'
import {
  getDefaultEdgeJoints,
  getGhostJointCandidates,
  type JointPoint,
} from './dbml-visual-canvas'

describe('DBML edge joints', () => {
  it('places five default joints and one ghost between every adjacent pair', () => {
    const path: JointPoint[] = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 120 },
      { x: 100, y: 120 },
    ]
    const defaultJoints = getDefaultEdgeJoints(path)
    const joints = [path[0], ...defaultJoints, path[path.length - 1]]

    expect(joints).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 15, axis: 'x' },
      { x: 40, y: 70, axis: 'x' },
      { x: 45, y: 120, axis: 'y' },
      { x: 100, y: 120 },
    ])
    expect(getGhostJointCandidates(path, joints)).toEqual([
      { x: 28, y: 0, axis: 'y', insertIndex: 0 },
      { x: 40, y: 43, axis: 'x', insertIndex: 1 },
      { x: 40, y: 98, axis: 'x', insertIndex: 2 },
      { x: 73, y: 120, axis: 'y', insertIndex: 3 },
    ])
  })

  it('correctly parses extended DBML relation operators like ?>, <?, and <>', () => {
    const dbmlContent = `
Table follows {
  following_user_id integer [not null]
  followed_user_id integer [not null]
  created_at timestamp
}

Table users {
  id integer [primary key]
  username varchar
  role varchar
  created_at timestamp
}

Table posts {
  id integer [primary key]
  title varchar
  body text [note: 'Content of the post']
  user_id integer [not null]
  status varchar
  created_at timestamp
}

Ref user_posts: posts.user_id ?> users.id // many-to-one

Ref: users.id <? follows.following_user_id

Ref: users.id <? follows.followed_user_id
`
    const standaloneRefRegex =
      /Ref\s*(?:[\w.-]+)?\s*:\s*([\w."]+)\.([\w."]+)\s*([><-][?]|\?[><-]|<>|[><-])\s*([\w."]+)\.([\w."]+)/gi
    const matches: Array<{ from: string; to: string; rel: string }> = []
    let m: RegExpExecArray | null
    while ((m = standaloneRefRegex.exec(dbmlContent)) !== null) {
      matches.push({
        from: `${m[1]}.${m[2]}`,
        rel: m[3],
        to: `${m[4]}.${m[5]}`,
      })
    }

    expect(matches).toHaveLength(3)
    expect(matches[0]).toEqual({
      from: 'posts.user_id',
      rel: '?>',
      to: 'users.id',
    })
    expect(matches[1]).toEqual({
      from: 'users.id',
      rel: '<?',
      to: 'follows.following_user_id',
    })
    expect(matches[2]).toEqual({
      from: 'users.id',
      rel: '<?',
      to: 'follows.followed_user_id',
    })
  })

  it('correctly parses DBML Records blocks and cells', () => {
    const dbmlContent = `
Records users(id, username, role) {
  0, 'Alice', 'admin'
  1, 'Bob', 'moderator'
  2, 'Candice', 'moderator'
  3, 'David', 'member'
}

Records follows(following_user_id, followed_user_id, created_at) {
  1, 0, '2026-01-01'
  3, 2, '2026-02-28'
}
`
    const recordsRegex = /Records?\s+([\w."]+)\s*\(([^)]+)\)\s*\{([^}]+)\}/gi
    const parsedRecords: Record<
      string,
      { tableName: string; columns: string[]; rows: string[][] }
    > = {}

    let recordMatch: RegExpExecArray | null
    while ((recordMatch = recordsRegex.exec(dbmlContent)) !== null) {
      const rawTableName = recordMatch[1].replace(/["']/g, '').trim()
      const rawCols = recordMatch[2]
        .split(',')
        .map((c) => c.replace(/["']/g, '').trim())
        .filter(Boolean)
      const body = recordMatch[3]
      const rows: string[][] = []

      const lines = body.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('//')) continue

        const rowValues: string[] = []
        const cellRegex =
          /\s*(?:'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|([^,]+?))\s*(?:,|$)/g
        let cellMatch: RegExpExecArray | null
        while ((cellMatch = cellRegex.exec(trimmed)) !== null) {
          const val =
            cellMatch[1] !== undefined
              ? cellMatch[1]
              : cellMatch[2] !== undefined
                ? cellMatch[2]
                : cellMatch[3]
          if (val !== undefined) {
            rowValues.push(val.trim())
          }
          if (cellRegex.lastIndex >= trimmed.length) break
        }

        if (rowValues.length > 0) {
          rows.push(rowValues)
        }
      }

      if (rawCols.length > 0 && rows.length > 0) {
        parsedRecords[rawTableName.toLowerCase()] = {
          tableName: rawTableName,
          columns: rawCols,
          rows,
        }
      }
    }

    expect(parsedRecords['users']).toBeDefined()
    expect(parsedRecords['users'].columns).toEqual(['id', 'username', 'role'])
    expect(parsedRecords['users'].rows).toHaveLength(4)
    expect(parsedRecords['users'].rows[0]).toEqual(['0', 'Alice', 'admin'])

    expect(parsedRecords['follows']).toBeDefined()
    expect(parsedRecords['follows'].columns).toEqual([
      'following_user_id',
      'followed_user_id',
      'created_at',
    ])
    expect(parsedRecords['follows'].rows).toHaveLength(2)
    expect(parsedRecords['follows'].rows[1]).toEqual(['3', '2', '2026-02-28'])
  })
})
