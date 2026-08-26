import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

export const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    backgroundColor: 'transparent',
    color: 'inherit',
  },
  '.cm-content': {
    caretColor: 'var(--color-primary, #3b82f6)',
    padding: '24px 32px',
    lineHeight: '1.75',
    minHeight: '100%',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--color-primary, #3b82f6)',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    {
      backgroundColor: 'rgba(59, 130, 246, 0.2) !important',
    },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--color-muted-foreground, #888)',
    border: 'none',
    borderRight: '1px solid var(--color-border, rgba(120, 120, 120, 0.15))',
    paddingLeft: '8px',
    paddingRight: '8px',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(120, 120, 120, 0.04)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--color-foreground, #111)',
    fontWeight: 'bold',
  },
  '.cm-line': {
    paddingLeft: '4px',
    paddingRight: '4px',
  },
})

export const markdownHighlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.heading, fontWeight: 'bold' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strong, fontWeight: 'bold' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.link, textDecoration: 'underline' },
    { tag: t.monospace, fontFamily: 'ui-monospace, monospace' },
    { tag: t.quote, fontStyle: 'italic' },
  ])
)
