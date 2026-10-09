import '@/styles/index.css'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'
import { switchLocalUser } from '@/lib/user-storage'
import { recoveryCopiesFor, saveRecoveryCopy } from '../lib/recovery-copies'
import type { SourceBinding } from '../lib/source-binding'
import { DbmlEditor } from './dbml-editor'
import { MermaidEditor } from './mermaid-editor'
import { RecoveryCopyNotice } from './recovery-copy-notice'
import type { SourceCollab } from './unified-monaco-editor'

const userID = '11111111-1111-4111-8111-111111111111'
const documentID = '22222222-2222-4222-8222-222222222222'

function shared(source: string, readOnly = false) {
  const doc = new Y.Doc()
  const text = doc.getText('source')
  text.insert(0, source)
  let binding: SourceBinding | null = null
  const collab: SourceCollab = {
    text,
    awareness: null,
    readOnly,
    onBinding: (next) => (binding = next),
  }
  return { text, collab, binding: () => binding }
}

const editorReady = () =>
  vi.waitFor(() =>
    expect(document.querySelector('.monaco-editor textarea')).toBeTruthy()
  )

describe('a DBML or Mermaid editor on a shared source', () => {
  beforeEach(() => switchLocalUser(userID))
  afterEach(() => switchLocalUser(null))

  it('lets a viewer read the source but change nothing, Format included', async () => {
    const { text, collab } = shared('Table a {\nid int\n}', true)
    const screen = await render(
      <div style={{ height: 500 }}>
        <DbmlEditor
          content={text.toString()}
          onChange={vi.fn()}
          collab={collab}
        />
      </div>
    )
    await editorReady()
    await vi.waitFor(() =>
      // Monaco renders spaces as no-break spaces.
      expect(
        document
          .querySelector('.view-lines')
          ?.textContent?.replace(/\u00a0/g, ' ')
      ).toContain('Table a')
    )
    await expect
      .element(screen.getByTitle('Beautify schema code'))
      .toBeDisabled()
    const input = document.querySelector<HTMLTextAreaElement>(
      '.monaco-editor textarea'
    )!
    input.focus()
    await userEvent.keyboard('typed')
    expect(text.toString()).toBe('Table a {\nid int\n}')
  })

  it('formats the source as it is now, as one step that Undo takes back', async () => {
    const { text, collab, binding } = shared('Table a {\nid int\n}')
    const screen = await render(
      <div style={{ height: 500 }}>
        <DbmlEditor content='' onChange={vi.fn()} collab={collab} />
      </div>
    )
    await editorReady()
    // Someone else wrote after the preview last rendered.
    text.insert(text.length, '\nTable b {\nname text\n}')
    await screen.getByTitle('Beautify schema code').click()
    expect(text.toString()).toBe(
      'Table a {\n  id int\n}\nTable b {\n  name text\n}'
    )
    binding()!.undo()
    expect(text.toString()).toBe(
      'Table a {\nid int\n}\nTable b {\nname text\n}'
    )
  })

  it('asks before a template replaces a shared diagram, and applies it once confirmed', async () => {
    const { text, collab } = shared('graph TD\n  A --> B')
    const screen = await render(
      <div style={{ height: 500 }}>
        <MermaidEditor
          content={text.toString()}
          onChange={vi.fn()}
          collab={collab}
        />
      </div>
    )
    await editorReady()
    await screen.getByTitle('Insert Mermaid Template').click()
    await page.getByText('Microservices Flowchart').click()
    await expect.element(page.getByText('Replace the diagram?')).toBeVisible()
    expect(text.toString()).toBe('graph TD\n  A --> B')
    await page.getByRole('button', { name: 'Keep diagram' }).click()
    expect(text.toString()).toBe('graph TD\n  A --> B')

    await screen.getByTitle('Insert Mermaid Template').click()
    await page.getByText('Microservices Flowchart').click()
    await page.getByRole('button', { name: 'Replace' }).click()
    expect(text.toString().startsWith('flowchart TD')).toBe(true)
  })

  it('applies a template to an empty diagram without asking', async () => {
    const { text, collab } = shared('')
    const screen = await render(
      <div style={{ height: 500 }}>
        <MermaidEditor content='' onChange={vi.fn()} collab={collab} />
      </div>
    )
    await editorReady()
    await screen.getByTitle('Insert Mermaid Template').click()
    await page.getByText('Git Feature Branching').click()
    expect(text.toString().startsWith('gitGraph')).toBe(true)
    expect(document.body.textContent).not.toContain('Replace the diagram?')
  })
})

describe('the recovery copy notice', () => {
  beforeEach(() => switchLocalUser(userID))
  afterEach(() => switchLocalUser(null))

  it('says unsent edits were kept, offers them, and forgets them once discarded', async () => {
    saveRecoveryCopy({
      workspaceID: '33333333-3333-4333-8333-333333333333',
      documentID,
      record: 'r1',
      title: 'Schema',
      source: 'Table mine {}',
      savedAt: '2026-10-09T10:00:00.000Z',
    })
    const screen = await render(<RecoveryCopyNotice documentID={documentID} />)
    await expect
      .element(screen.getByText(/edits this device had not sent/i))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Download' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Discard' }).click()
    expect(recoveryCopiesFor(documentID)).toEqual([])
    expect(document.body.textContent).not.toMatch(
      /edits this device had not sent/i
    )
  })

  it('shows nothing when there is nothing to recover', async () => {
    const screen = await render(<RecoveryCopyNotice documentID={documentID} />)
    expect(screen.container.textContent).toBe('')
  })
})
