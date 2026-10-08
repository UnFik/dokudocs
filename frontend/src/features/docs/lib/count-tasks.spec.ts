import { describe, expect, it } from 'vitest'
import { countTasks } from './count-tasks'

describe('countTasks', () => {
  it('counts open and done task items in Markdown', () => {
    expect(
      countTasks('- [ ] one\n- [x] two\n- [X] three\n* [ ] four\n')
    ).toEqual({
      done: 2,
      total: 4,
    })
  })

  it('counts nested and numbered task items', () => {
    expect(countTasks('- [ ] a\n  - [x] b\n1. [ ] c\n')).toEqual({
      done: 1,
      total: 3,
    })
  })

  it('ignores brackets in the middle of a line and in code', () => {
    expect(
      countTasks('text [ ] not a task\n```\n- [ ] in code\n```\n')
    ).toEqual({
      done: 0,
      total: 0,
    })
  })

  it('is zero for no text', () => {
    expect(countTasks('')).toEqual({ done: 0, total: 0 })
  })
})
