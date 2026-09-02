import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { useEditorPreferenceStore } from '@/stores/editor-preference-store'
import { DbmlEditor } from './dbml-editor'
import { MarkdownEditor } from './markdown-editor'
import { MermaidEditor } from './mermaid-editor'

describe('Document Editors (Markdown, DBML, Mermaid)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEditorPreferenceStore.getState().setViewMode('guest', 'split')
  })

  describe('MarkdownEditor', () => {
    it('renders outline button and view mode actions', async () => {
      const handleChange = vi.fn()
      const screen = await render(
        <MarkdownEditor
          docId='doc-md-1'
          content='# Hello World'
          onChange={handleChange}
        />
      )

      await expect
        .element(screen.getByTitle('Toggle Outline / Table of Contents'))
        .toBeInTheDocument()
      await expect
        .element(screen.getByTitle('Read-only rendered document'))
        .toBeInTheDocument()
      await expect
        .element(screen.getByTitle('In-place interactive rich editor'))
        .toBeInTheDocument()
    })
  })

  describe('DbmlEditor', () => {
    it('renders format button and formats unindented schema lines on click', async () => {
      const handleChange = vi.fn()
      const unformattedDbml = 'Table users {\nid int\nname varchar\n}'
      const screen = await render(
        <DbmlEditor
          docId='doc-dbml-1'
          content={unformattedDbml}
          onChange={handleChange}
        />
      )

      const formatBtn = screen.getByTitle('Beautify schema code')
      await userEvent.click(formatBtn)

      expect(handleChange).toHaveBeenCalledWith(
        'Table users {\n  id int\n  name varchar\n}'
      )
    })
  })

  describe('MermaidEditor', () => {
    it('opens templates modal and inserts selected template code', async () => {
      const handleChange = vi.fn()
      const initialCode = 'flowchart TD\n  Start --> Stop'
      const screen = await render(
        <MermaidEditor
          docId='doc-mermaid-1'
          content={initialCode}
          onChange={handleChange}
        />
      )

      const templatesBtn = screen.getByTitle('Insert Mermaid Template')
      await userEvent.click(templatesBtn)

      await expect
        .element(page.getByText('Sequence API Authentication Flow'))
        .toBeInTheDocument()
      await expect
        .element(page.getByText('Microservices Flowchart'))
        .toBeInTheDocument()

      const useTemplateBtns = page.getByRole('button', {
        name: /^Use Template$/i,
      })
      await userEvent.click(useTemplateBtns.all()[0])

      expect(handleChange).toHaveBeenCalled()
    })
  })
})
