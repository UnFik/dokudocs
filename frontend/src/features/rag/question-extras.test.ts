import { describe, expect, it } from 'vitest'
import {
  MAX_ATTACHMENT_CHARS,
  MAX_FILES,
  readAttachments,
} from './question-extras'

const file = (name: string, text: string) =>
  new File([text], name, { type: 'text/plain' })

describe('readAttachments', () => {
  it('reads text files as they are', async () => {
    const result = await readAttachments(
      [file('notes.txt', 'The vault code is 314.'), file('Plan.MD', '# Plan')],
      []
    )
    expect(result).toEqual({
      attachments: [
        { name: 'notes.txt', text: 'The vault code is 314.' },
        { name: 'Plan.MD', text: '# Plan' },
      ],
    })
  })

  it('refuses a kind of file it cannot read as text, and says which', async () => {
    const result = await readAttachments([file('logo.png', 'x')], [])
    expect(result).toEqual({
      attachments: [],
      error:
        'logo.png is not a text file. Attach .txt, .md, .csv, .tsv, .json or .log files.',
    })
  })

  it('refuses an empty file', async () => {
    const result = await readAttachments([file('empty.txt', '  ')], [])
    expect(result.error).toBe('empty.txt has no text in it.')
  })

  it(`stops at ${MAX_FILES} files in all`, async () => {
    const have = Array.from({ length: MAX_FILES }, (_, i) => ({
      name: `f${i}.txt`,
      text: 'x',
    }))
    const result = await readAttachments([file('one-more.txt', 'x')], have)
    expect(result.attachments).toEqual(have)
    expect(result.error).toBe(
      `Attach up to ${MAX_FILES} files to one question.`
    )
  })

  it('stops when all the text together would be too long', async () => {
    const result = await readAttachments(
      [file('big.txt', 'x'.repeat(MAX_ATTACHMENT_CHARS + 1))],
      []
    )
    expect(result.attachments).toEqual([])
    expect(result.error).toMatch(/too long/)
  })

  it('does not attach the same file twice', async () => {
    const have = [{ name: 'notes.txt', text: 'a' }]
    const result = await readAttachments([file('notes.txt', 'a')], have)
    expect(result.attachments).toEqual(have)
    expect(result.error).toBeUndefined()
  })
})
