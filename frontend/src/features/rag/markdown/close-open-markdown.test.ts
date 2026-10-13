import { describe, expect, it } from 'vitest'
import { closeOpenMarkdown } from './close-open-markdown'

describe('closeOpenMarkdown', () => {
  it('leaves finished Markdown alone', () => {
    const text = '**bold** and `code`\n\n```go\nfmt.Println()\n```\n'
    expect(closeOpenMarkdown(text)).toBe(text)
  })

  it('closes a code fence that is still being written', () => {
    expect(closeOpenMarkdown('Run:\n\n```bash\nmake test')).toBe(
      'Run:\n\n```bash\nmake test\n```'
    )
  })

  it('closes a fence with the same marker it opened with', () => {
    expect(closeOpenMarkdown('~~~\nline')).toBe('~~~\nline\n~~~')
    expect(closeOpenMarkdown('````md\n```\ninner')).toBe(
      '````md\n```\ninner\n````'
    )
  })

  it('does not touch markers inside a fence', () => {
    expect(closeOpenMarkdown('```\na **b `c\n```')).toBe('```\na **b `c\n```')
  })

  it('closes bold, italic, strike and inline code left open', () => {
    expect(closeOpenMarkdown('so **really important')).toBe(
      'so **really important**'
    )
    expect(closeOpenMarkdown('an *emphasis')).toBe('an *emphasis*')
    expect(closeOpenMarkdown('gone ~~wrong')).toBe('gone ~~wrong~~')
    expect(closeOpenMarkdown('call `foo(')).toBe('call `foo(`')
  })

  it('closes nested markers innermost first', () => {
    expect(closeOpenMarkdown('**bold and `code')).toBe('**bold and `code`**')
  })

  it('drops an opener that has no text after it yet', () => {
    expect(closeOpenMarkdown('so **')).toBe('so ')
    expect(closeOpenMarkdown('so *')).toBe('so ')
    expect(closeOpenMarkdown('so `')).toBe('so ')
  })

  it('ignores markers inside inline code and escaped ones', () => {
    expect(closeOpenMarkdown('use `**` here')).toBe('use `**` here')
    expect(closeOpenMarkdown('a \\* b')).toBe('a \\* b')
  })

  it('does not read a list bullet or a spaced star as emphasis', () => {
    expect(closeOpenMarkdown('* one\n* two')).toBe('* one\n* two')
    expect(closeOpenMarkdown('2 * 3 = 6')).toBe('2 * 3 = 6')
  })

  it('shows the label of a link that is not finished', () => {
    expect(closeOpenMarkdown('see [Run')).toBe('see Run')
    expect(closeOpenMarkdown('see [Runbook](doc:3f2')).toBe('see Runbook')
    expect(closeOpenMarkdown('see [Runbook](doc:3f2) now')).toBe(
      'see [Runbook](doc:3f2) now'
    )
  })

  it('only repairs the paragraph being written', () => {
    expect(closeOpenMarkdown('a * b\n\nso **new')).toBe('a * b\n\nso **new**')
  })
})
