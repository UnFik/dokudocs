import { useState } from 'react'
import * as monaco from 'monaco-editor'
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

    it('treats a stored suggest mode as View in the local editor', async () => {
      useEditorPreferenceStore.getState().setPreviewMode('guest', 'suggest')
      useEditorPreferenceStore.getState().setViewMode('guest', 'preview')
      const screen = await render(
        <MarkdownEditor
          docId='doc-md-suggest'
          content='# Hello'
          onChange={vi.fn()}
        />
      )
      await expect
        .element(screen.getByTestId('preview-mode-view'))
        .toHaveClass('font-semibold')
      await expect
        .element(screen.getByTestId('preview-mode-edit'))
        .not.toHaveClass('font-semibold')
      await expect
        .poll(() =>
          document.querySelector('.muya-container [contenteditable="true"]')
        )
        .toBeNull()
      useEditorPreferenceStore.getState().setPreviewMode('guest', 'edit')
      await screen.unmount()
    })

    it('preserves Markdown when switching between source editor and preview', async () => {
      const handleChange = vi.fn()
      const initialContent = '# Initial heading\n\nInitial paragraph.\n'
      const updatedContent = '# Updated heading\n\nUpdated paragraph.\n'
      function ControlledMarkdownEditor() {
        const [content, setContent] = useState(initialContent)
        return (
          <MarkdownEditor
            docId='doc-md-transition'
            content={content}
            onChange={(nextContent) => {
              handleChange(nextContent)
              setContent(nextContent)
            }}
          />
        )
      }
      const screen = await render(<ControlledMarkdownEditor />)

      const model = await vi.waitFor(() => {
        const currentModel = monaco.editor
          .getModels()
          .find((candidate) => candidate.getValue() === initialContent)
        expect(currentModel).toBeDefined()
        return currentModel!
      })

      model.setValue(updatedContent)
      await userEvent.click(
        screen.getByRole('button', { name: 'Preview', exact: true })
      )
      await expect
        .element(screen.getByText('Updated heading', { exact: true }))
        .toBeInTheDocument()

      await userEvent.click(
        screen.getByRole('button', { name: 'Editor', exact: true })
      )
      await vi.waitFor(() => {
        expect(
          monaco.editor
            .getModels()
            .some((candidate) => candidate.getValue() === updatedContent)
        ).toBe(true)
      })
      expect(handleChange).toHaveBeenLastCalledWith(updatedContent)
      await screen.unmount()
    })

    it('keeps the Muya caret at the insertion point after controlled onChange', async () => {
      const handleChange = vi.fn()
      function ControlledMarkdownEditor() {
        const [content, setContent] = useState('Existing paragraph')
        return (
          <MarkdownEditor
            docId='doc-md-caret'
            content={content}
            onChange={(nextContent) => {
              handleChange(nextContent)
              setContent(nextContent)
            }}
          />
        )
      }

      const screen = await render(<ControlledMarkdownEditor />)
      await userEvent.click(screen.getByTestId('preview-mode-edit'))
      const editable = await vi.waitFor(() => {
        const element = document.querySelector<HTMLElement>(
          '.muya-container [contenteditable="true"]'
        )
        expect(element).toBeTruthy()
        return element!
      })

      await userEvent.click(editable)
      await userEvent.keyboard('{End}')
      await userEvent.type(editable, ' X')

      await vi.waitFor(() => {
        expect(handleChange).toHaveBeenLastCalledWith(
          expect.stringContaining('Existing paragraph X')
        )
      })

      const selection = window.getSelection()
      expect(selection?.anchorNode?.textContent).toContain(
        'Existing paragraph X'
      )
      expect(selection?.anchorOffset).toBe(
        selection?.anchorNode?.textContent?.length
      )

      await userEvent.type(editable, 'Y')
      await vi.waitFor(() => {
        expect(handleChange).toHaveBeenLastCalledWith(
          expect.stringContaining('Existing paragraph XY')
        )
      })
      await screen.unmount()
    })

    it('debounces Muya onChange while typing', async () => {
      const handleChange = vi.fn()
      const screen = await render(
        <MarkdownEditor
          docId='doc-md-debounce'
          content='Existing paragraph'
          onChange={handleChange}
        />
      )

      await userEvent.click(screen.getByTestId('preview-mode-edit'))
      const editable = await vi.waitFor(() => {
        const element = document.querySelector<HTMLElement>(
          '.muya-container [contenteditable="true"]'
        )
        expect(element).toBeTruthy()
        return element!
      })

      await new Promise((resolve) => setTimeout(resolve, 350))
      handleChange.mockClear()
      await userEvent.click(editable)
      await userEvent.keyboard('{End}')
      await userEvent.type(editable, ' XY')

      expect(handleChange).not.toHaveBeenCalled()
      await vi.waitFor(() => {
        expect(handleChange).toHaveBeenLastCalledWith(
          expect.stringContaining('Existing paragraph XY')
        )
      })
      expect(handleChange).toHaveBeenCalledTimes(1)
      await screen.unmount()
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
