export interface LineChange {
  kind: 'added' | 'removed'
  text: string
}

/** The lines that differ between two versions of a page, found with a longest-common-subsequence match. */
export function changesBetween(before: string, after: string): LineChange[] {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  const table = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
  const changes: LineChange[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++
      j++
    } else if (
      j >= b.length ||
      (i < a.length && table[i + 1]![j]! >= table[i]![j + 1]!)
    ) {
      changes.push({ kind: 'removed', text: a[i++]! })
    } else {
      changes.push({ kind: 'added', text: b[j++]! })
    }
  }
  return changes
}
