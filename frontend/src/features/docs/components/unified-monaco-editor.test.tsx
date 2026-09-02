import * as monaco from 'monaco-editor'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { useEditorPreferenceStore } from '@/stores/editor-preference-store'
import { UnifiedMonacoEditor } from './unified-monaco-editor'

describe('UnifiedMonacoEditor component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEditorPreferenceStore.getState().setViewMode('guest', 'split')
  })

  it('renders editor and preview pane in split mode by default', async () => {
    const handleChange = vi.fn()
    const screen = await render(
      <UnifiedMonacoEditor
        content='# Initial Title'
        onChange={handleChange}
        language='markdown'
        previewTitle='Markdown Preview'
        previewContent={<div data-testid='preview-slot'>Preview Content</div>}
      />
    )

    await expect.element(screen.getByTestId('preview-slot')).toBeInTheDocument()
    await expect
      .element(screen.getByText('Markdown Preview'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: /^Editor$/i }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: /^Split$/i }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: /^Preview$/i }))
      .toBeInTheDocument()
  })

  it('switches view mode when bottom buttons are clicked', async () => {
    const handleChange = vi.fn()
    const screen = await render(
      <UnifiedMonacoEditor
        content='test content'
        onChange={handleChange}
        language='markdown'
        previewContent={<div data-testid='rendered-preview'>Visual</div>}
      />
    )

    const previewBtn = screen.getByRole('button', { name: /^Preview$/i })
    await userEvent.click(previewBtn)
    await expect
      .element(screen.getByTestId('rendered-preview'))
      .toBeInTheDocument()

    const editorBtn = screen.getByRole('button', { name: /^Editor$/i })
    await userEvent.click(editorBtn)
    await expect.element(editorBtn).toBeInTheDocument()
  })

  it('opens keyboard shortcuts dialog when help icon is clicked', async () => {
    const handleChange = vi.fn()
    const screen = await render(
      <UnifiedMonacoEditor
        content='short content'
        onChange={handleChange}
        language='markdown'
        previewContent={<div>Preview</div>}
      />
    )

    const helpBtn = screen.getByTitle('Shortcuts Help')
    await userEvent.click(helpBtn)

    await expect
      .element(page.getByRole('heading', { name: 'Editor Keyboard Shortcuts' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByText(/High performance Monaco/i))
      .toBeInTheDocument()
  })

  it('toggles live render mode and displays sync button when paused', async () => {
    const handleChange = vi.fn()
    const screen = await render(
      <UnifiedMonacoEditor
        content='code'
        onChange={handleChange}
        language='dbml'
        previewContent={<div>DBML Canvas</div>}
        showLiveRenderToggle={true}
      />
    )

    const liveToggle = screen.getByTitle(/Live Render is ON/i)
    await userEvent.click(liveToggle)

    await expect
      .element(screen.getByText('Paused', { exact: true }))
      .toBeInTheDocument()
  })

  it('handles external updates when content prop changes from outside', async () => {
    const handleChange = vi.fn()
    let currentContent = 'Initial Text'

    const { rerender } = await render(
      <UnifiedMonacoEditor
        content={currentContent}
        onChange={handleChange}
        language='markdown'
        previewContent={<div>Preview</div>}
      />
    )

    currentContent = 'Updated externally via template'
    await rerender(
      <UnifiedMonacoEditor
        content={currentContent}
        onChange={handleChange}
        language='markdown'
        previewContent={<div>Preview</div>}
      />
    )

    const models = monaco.editor.getModels()
    const activeModel = models[models.length - 1]
    expect(activeModel?.getValue()).toBe('Updated externally via template')
  })

  it('preserves typed content without overwriting when parent re-renders', async () => {
    const handleChange = vi.fn()
    const parentState = 'initial'

    const { rerender } = await render(
      <UnifiedMonacoEditor
        content={parentState}
        onChange={handleChange}
        language='markdown'
        previewContent={<div>Preview</div>}
      />
    )

    const models = monaco.editor.getModels()
    const activeModel = models[models.length - 1]
    activeModel?.setValue('typed locally by user')

    await rerender(
      <UnifiedMonacoEditor
        content={parentState}
        onChange={handleChange}
        language='markdown'
        previewContent={<div>Preview</div>}
      />
    )

    expect(activeModel?.getValue()).toBe('typed locally by user')
  })

  it('renders floating theme toggle button in preview pane and allows clicking', async () => {
    const handleChange = vi.fn()
    const screen = await render(
      <UnifiedMonacoEditor
        content='# Preview test'
        onChange={handleChange}
        language='markdown'
        previewContent={<div>Preview Content</div>}
      />
    )

    const themeToggleBtn = screen.getByRole('button', { name: /toggle theme/i })
    await expect.element(themeToggleBtn).toBeInTheDocument()
    await userEvent.click(themeToggleBtn)
    await expect.element(themeToggleBtn).toBeInTheDocument()
  })
})
