import { EditorView } from '@codemirror/view'
import { Extension } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

export const dokudocsTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    backgroundColor: 'transparent',
    color: 'inherit',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'inherit',
    lineHeight: '1.65',
  },
  '.cm-content': {
    padding: '12px 0',
    caretColor: 'var(--foreground, #000000)',
  },
  '.cm-line': {
    padding: '0 12px',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--primary, #10b981)',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(16, 185, 129, 0.22) !important',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--muted, #f4f4f5)',
    opacity: '0.65',
    color: 'var(--muted-foreground, #71717a)',
    borderRight: '1px solid var(--border, #e4e4e7)',
    paddingRight: '6px',
    userSelect: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--foreground, #09090b)',
    fontWeight: 'bold',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(0, 0, 0, 0.03)',
  },
  '.dark .cm-activeLine': {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(234, 179, 8, 0.25)',
    borderRadius: '2px',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(234, 179, 8, 0.35)',
    outline: '1px solid rgba(234, 179, 8, 0.7)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'rgba(234, 179, 8, 0.65)',
  },
  '.cm-tooltip': {
    border: '1px solid var(--border, #e4e4e7)',
    backgroundColor: 'var(--background, #ffffff)',
    borderRadius: '8px',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
  },
  '.cm-tooltip-autocomplete': {
    '& > ul': {
      fontFamily: 'inherit',
      fontSize: '12px',
      maxHeight: '220px',
    },
    '& > ul > li': {
      padding: '4px 8px',
      borderRadius: '4px',
    },
    '& > ul > li[aria-selected]': {
      backgroundColor: 'rgba(16, 185, 129, 0.15)',
      color: '#059669',
      fontWeight: '600',
    },
  },
})

export const dokudocsHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#2563eb', fontWeight: 'bold' },
  { tag: t.typeName, color: '#059669', fontWeight: '600' },
  { tag: t.definition(t.typeName), color: '#0d9488', fontWeight: 'bold' },
  { tag: t.propertyName, color: '#4f46e5' },
  { tag: t.definition(t.propertyName), color: '#2563eb', fontWeight: '600' },
  { tag: t.variableName, color: 'inherit' },
  { tag: t.definition(t.variableName), color: '#0284c7', fontWeight: 'bold' },
  { tag: t.attributeName, color: '#d97706', fontWeight: '600' },
  { tag: t.string, color: '#16a34a' },
  { tag: t.number, color: '#dc2626' },
  { tag: t.bool, color: '#d97706' },
  { tag: t.operator, color: '#9333ea', fontWeight: '600' },
  { tag: t.comment, color: '#94a3b8', fontStyle: 'italic' },
  { tag: t.bracket, color: '#64748b' },
  { tag: t.punctuation, color: '#64748b' },
  { tag: t.heading, color: '#7c3aed', fontWeight: 'bold' },
  { tag: t.labelName, color: '#7c3aed', fontWeight: '600' },
])

export const dokudocsDarkHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#60a5fa', fontWeight: 'bold' },
  { tag: t.typeName, color: '#34d399', fontWeight: '600' },
  { tag: t.definition(t.typeName), color: '#2dd4bf', fontWeight: 'bold' },
  { tag: t.propertyName, color: '#818cf8' },
  { tag: t.definition(t.propertyName), color: '#60a5fa', fontWeight: '600' },
  { tag: t.variableName, color: 'inherit' },
  { tag: t.definition(t.variableName), color: '#38bdf8', fontWeight: 'bold' },
  { tag: t.attributeName, color: '#fbbf24', fontWeight: '600' },
  { tag: t.string, color: '#4ade80' },
  { tag: t.number, color: '#f87171' },
  { tag: t.bool, color: '#fbbf24' },
  { tag: t.operator, color: '#c084fc', fontWeight: '600' },
  { tag: t.comment, color: '#64748b', fontStyle: 'italic' },
  { tag: t.bracket, color: '#94a3b8' },
  { tag: t.punctuation, color: '#94a3b8' },
  { tag: t.heading, color: '#a78bfa', fontWeight: 'bold' },
  { tag: t.labelName, color: '#a78bfa', fontWeight: '600' },
])

export function getDokudocsThemeExtensions(isDark = false): Extension[] {
  return [
    dokudocsTheme,
    syntaxHighlighting(isDark ? dokudocsDarkHighlightStyle : dokudocsHighlightStyle),
  ]
}
