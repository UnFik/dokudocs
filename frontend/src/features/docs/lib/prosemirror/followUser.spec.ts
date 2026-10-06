import { describe, expect, it } from 'vitest'
import { mountTestEditor, paragraphsBody } from './editorTestKit'

function longEditor() {
  const texts = Array.from({ length: 80 }, (_, index) => `line ${index}`)
  const mounted = mountTestEditor(paragraphsBody(...texts))
  mounted.host.style.cssText = 'height:200px;overflow:auto'
  return { ...mounted, texts }
}

function cursorAt(
  editor: ReturnType<typeof mountTestEditor>['editor'],
  text: string,
  userID = 'u2'
) {
  let position = 0
  editor.view.state.doc.descendants((node, at) => {
    if (node.type.name === 'run' && node.textContent === text) position = at + 1
  })
  const anchor = editor.createAnchor(position + 1, position + 3)
  return {
    connectionID: `c-${userID}`,
    userID,
    name: 'Bo',
    color: '#0369A1',
    anchor: anchor.start,
    head: anchor.end,
  }
}

function visible(host: HTMLElement, element: Element) {
  const box = host.getBoundingClientRect()
  const at = element.getBoundingClientRect()
  return at.top >= box.top && at.bottom <= box.bottom
}

describe('following a collaborator', () => {
  it('brings their cursor into view and keeps up when it moves', () => {
    const { editor, host, cleanup } = longEditor()
    try {
      editor.follow('u2')
      editor.setRemoteCursors([cursorAt(editor, 'line 70')])
      expect(visible(host, host.querySelector('.remote-cursor')!)).toBe(true)
      editor.setRemoteCursors([cursorAt(editor, 'line 5')])
      expect(visible(host, host.querySelector('.remote-cursor')!)).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('does not move the page for someone who is not followed', () => {
    const { editor, host, cleanup } = longEditor()
    try {
      editor.setRemoteCursors([cursorAt(editor, 'line 70')])
      expect(visible(host, host.querySelector('.remote-cursor')!)).toBe(false)
      editor.follow('u3')
      editor.setRemoteCursors([cursorAt(editor, 'line 70')])
      expect(visible(host, host.querySelector('.remote-cursor')!)).toBe(false)
    } finally {
      cleanup()
    }
  })

  it('stops when following is switched off', () => {
    const { editor, host, cleanup } = longEditor()
    try {
      editor.follow('u2')
      editor.follow(null)
      editor.setRemoteCursors([cursorAt(editor, 'line 70')])
      expect(visible(host, host.querySelector('.remote-cursor')!)).toBe(false)
    } finally {
      cleanup()
    }
  })
})
