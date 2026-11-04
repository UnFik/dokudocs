import { captureDownloads } from '@/test-utils/download'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  exportDocument,
  exportFileName,
  exportMarkdown,
} from './export-document'

afterEach(() => vi.restoreAllMocks())

describe('exportFileName', () => {
  it('keeps the words of a title and replaces the characters a file name cannot hold', () => {
    expect(exportFileName('Q3/Q4 plan', 'pdf')).toBe('Q3-Q4 plan.pdf')
    expect(exportFileName('a\\b:c*d?e"f<g>h|i', 'md')).toBe(
      'a-b-c-d-e-f-g-h-i.md'
    )
  })

  it('keeps letters of any script', () => {
    expect(exportFileName('会議メモ', 'docx')).toBe('会議メモ.docx')
    expect(exportFileName('Rencana Anggaran Pendapatan', 'pdf')).toBe(
      'Rencana Anggaran Pendapatan.pdf'
    )
  })

  it('falls back to Untitled when nothing usable is left', () => {
    expect(exportFileName('', 'md')).toBe('Untitled.md')
    expect(exportFileName('   ', 'pdf')).toBe('Untitled.pdf')
    expect(exportFileName('...', 'docx')).toBe('Untitled.docx')
  })

  it('drops leading dots, trailing dots and spaces, and control characters', () => {
    expect(exportFileName('..hidden', 'md')).toBe('hidden.md')
    expect(exportFileName('notes. ', 'md')).toBe('notes.md')
    expect(exportFileName('a\u0000b\nc', 'md')).toBe('abc.md')
  })

  it('caps a very long title without cutting a character in half', () => {
    const name = exportFileName('😀'.repeat(300), 'pdf')

    expect(Array.from(name.replace(/\.pdf$/, '')).length).toBe(120)
    expect(name).toBe('😀'.repeat(120) + '.pdf')
  })
})

describe('exportMarkdown', () => {
  it('downloads the Markdown as a UTF-8 .md file named after the title', async () => {
    const markdown =
      '# Rencana\n\n![diagram](/api/v1/documents/d1/assets/a1)\n\n会議 — café\n'

    const [file, ...others] = await captureDownloads(() =>
      exportMarkdown(markdown, 'Q3/Q4 plan')
    )

    expect(others).toHaveLength(0)
    expect(file!.name).toBe('Q3-Q4 plan.md')
    expect(file!.type).toMatch(/^text\/markdown/)
    expect(new TextDecoder('utf-8', { fatal: true }).decode(file!.bytes)).toBe(
      markdown
    )
    expect(Array.from(file!.bytes.slice(0, 3))).not.toEqual([0xef, 0xbb, 0xbf])
  })
})

describe('exportDocument', () => {
  it('exports the Markdown format and returns the name of the file it saved', async () => {
    const context = {
      documentID: 'b1f973dd-b554-4540-95c0-4697726ad6e1',
      workspaceID: '149a8d07-8490-43ed-98fa-ebaa91b05e90',
      title: 'Runbook',
      markdown: '# Runbook\n',
    }

    let name = ''
    const [file] = await captureDownloads(async () => {
      name = await exportDocument('md', context)
    })

    expect(name).toBe('Runbook.md')
    expect(file!.name).toBe('Runbook.md')
    expect(new TextDecoder().decode(file!.bytes)).toBe('# Runbook\n')
  })
})
