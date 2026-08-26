import {
  Decoration,
  DecorationSet,
  EditorView,
} from '@codemirror/view'
import { EditorState, Range, StateField } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import {
  CheckboxWidget,
  HorizontalRuleWidget,
  TableWidget,
} from './widgets'

const hideMark = Decoration.replace({})

function buildDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const selection = state.selection.main
  const cursorHead = selection.head

  syntaxTree(state).iterate({
    from: 0,
    to: state.doc.length,
    enter: (node) => {
      const nodeFrom = node.from
      const nodeTo = node.to
      const nodeType = node.name

      const isCursorInside =
        cursorHead >= nodeFrom && cursorHead <= nodeTo

      const line = state.doc.lineAt(nodeFrom)
      const isCursorOnLine =
        cursorHead >= line.from && cursorHead <= line.to

      if (
        nodeType === 'ATXHeading1' ||
        nodeType === 'ATXHeading2' ||
        nodeType === 'ATXHeading3' ||
        nodeType === 'ATXHeading4' ||
        nodeType === 'ATXHeading5' ||
        nodeType === 'ATXHeading6'
      ) {
        const level = Number(nodeType.replace('ATXHeading', ''))
        const headingClass =
          level === 1
            ? 'cm-heading cm-heading-1 text-3xl font-bold tracking-tight text-foreground my-2'
            : level === 2
            ? 'cm-heading cm-heading-2 text-2xl font-bold tracking-tight text-foreground my-2'
            : level === 3
            ? 'cm-heading cm-heading-3 text-xl font-semibold text-foreground my-1.5'
            : 'cm-heading cm-heading-4 text-lg font-semibold text-foreground my-1'

        decorations.push(
          Decoration.line({
            class: headingClass,
          }).range(line.from)
        )

        const headerMark = node.node.getChild('HeaderMark')
        if (!isCursorOnLine && headerMark) {
          const markEnd = Math.min(
            headerMark.to + (state.doc.sliceString(headerMark.to, headerMark.to + 1) === ' ' ? 1 : 0),
            state.doc.length
          )
          decorations.push(hideMark.range(headerMark.from, markEnd))
        }
      }

      if (nodeType === 'Table') {
        if (!isCursorInside) {
          const tableText = state.doc.sliceString(nodeFrom, nodeTo)
          decorations.push(
            Decoration.replace({
              widget: new TableWidget(tableText),
              block: true,
            }).range(nodeFrom, nodeTo)
          )
          return false
        }
      }

      if (nodeType === 'FencedCode') {
        const codeLines = state.doc.sliceString(nodeFrom, nodeTo).split('\n')
        const startLine = state.doc.lineAt(nodeFrom)
        const endLine = state.doc.lineAt(nodeTo)

        if (!isCursorInside) {
          for (let l = startLine.number; l <= endLine.number; l++) {
            const curLine = state.doc.line(l)
            decorations.push(
              Decoration.line({
                class: 'cm-fenced-code bg-muted/40 font-mono text-xs px-2',
              }).range(curLine.from)
            )
          }

          const codeInfo = node.node.getChild('CodeInfo')
          const openFenceEnd = codeInfo ? codeInfo.to : nodeFrom + 3
          if (openFenceEnd <= startLine.to) {
            decorations.push(hideMark.range(nodeFrom, Math.min(startLine.to + 1, nodeTo)))
          }

          if (endLine.from >= nodeFrom && endLine.to <= nodeTo && codeLines.length > 1) {
            decorations.push(hideMark.range(endLine.from, nodeTo))
          }
        } else {
          for (let l = startLine.number; l <= endLine.number; l++) {
            const curLine = state.doc.line(l)
            decorations.push(
              Decoration.line({
                class: 'cm-fenced-code-editing bg-muted/30 font-mono text-xs px-2',
              }).range(curLine.from)
            )
          }
        }
      }

      if (nodeType === 'StrongEmphasis') {
        if (!isCursorInside) {
          const text = state.doc.sliceString(nodeFrom, nodeTo)
          const markLen = text.startsWith('**') || text.startsWith('__') ? 2 : 0
          if (markLen > 0 && nodeTo - nodeFrom >= markLen * 2) {
            decorations.push(hideMark.range(nodeFrom, nodeFrom + markLen))
            decorations.push(
              Decoration.mark({
                class: 'cm-bold font-bold text-foreground',
              }).range(nodeFrom + markLen, nodeTo - markLen)
            )
            decorations.push(hideMark.range(nodeTo - markLen, nodeTo))
          }
        }
      }

      if (nodeType === 'Emphasis') {
        if (!isCursorInside) {
          const text = state.doc.sliceString(nodeFrom, nodeTo)
          const markLen = text.startsWith('*') || text.startsWith('_') ? 1 : 0
          if (markLen > 0 && nodeTo - nodeFrom >= markLen * 2) {
            decorations.push(hideMark.range(nodeFrom, nodeFrom + markLen))
            decorations.push(
              Decoration.mark({
                class: 'cm-italic italic text-foreground',
              }).range(nodeFrom + markLen, nodeTo - markLen)
            )
            decorations.push(hideMark.range(nodeTo - markLen, nodeTo))
          }
        }
      }

      if (nodeType === 'Strikethrough') {
        if (!isCursorInside) {
          const text = state.doc.sliceString(nodeFrom, nodeTo)
          if (text.startsWith('~~') && text.endsWith('~~') && nodeTo - nodeFrom >= 4) {
            decorations.push(hideMark.range(nodeFrom, nodeFrom + 2))
            decorations.push(
              Decoration.mark({
                class: 'cm-strikethrough line-through opacity-70',
              }).range(nodeFrom + 2, nodeTo - 2)
            )
            decorations.push(hideMark.range(nodeTo - 2, nodeTo))
          }
        }
      }

      if (nodeType === 'InlineCode') {
        if (!isCursorInside) {
          const text = state.doc.sliceString(nodeFrom, nodeTo)
          if (text.startsWith('`') && text.endsWith('`') && nodeTo - nodeFrom >= 2) {
            decorations.push(hideMark.range(nodeFrom, nodeFrom + 1))
            decorations.push(
              Decoration.mark({
                class:
                  'cm-inline-code bg-muted/80 text-primary border border-border/60 px-1.5 py-0.5 rounded font-mono text-[12px]',
              }).range(nodeFrom + 1, nodeTo - 1)
            )
            decorations.push(hideMark.range(nodeTo - 1, nodeTo))
          }
        }
      }

      if (nodeType === 'Link') {
        if (!isCursorInside) {
          const text = state.doc.sliceString(nodeFrom, nodeTo)
          const linkMatch = text.match(/^\[(.*?)\]\((.*?)\)$/)
          if (linkMatch) {
            const textContent = linkMatch[1]
            const url = linkMatch[2]
            decorations.push(hideMark.range(nodeFrom, nodeFrom + 1))
            decorations.push(
              Decoration.mark({
                class: 'cm-link text-blue-500 hover:text-blue-600 underline cursor-pointer',
                attributes: { 'data-url': url },
              }).range(nodeFrom + 1, nodeFrom + 1 + textContent.length)
            )
            decorations.push(hideMark.range(nodeFrom + 1 + textContent.length, nodeTo))
          }
        }
      }

      if (nodeType === 'TaskMarker') {
        if (!isCursorInside) {
          const text = state.doc.sliceString(nodeFrom, nodeTo)
          const isChecked = text.toLowerCase().includes('x')
          decorations.push(
            Decoration.replace({
              widget: new CheckboxWidget(isChecked, nodeFrom),
            }).range(nodeFrom, nodeTo)
          )
        }
      }

      if (nodeType === 'HorizontalRule') {
        if (!isCursorOnLine) {
          decorations.push(
            Decoration.replace({
              widget: new HorizontalRuleWidget(),
            }).range(nodeFrom, nodeTo)
          )
        }
      }

      if (nodeType === 'Blockquote') {
        decorations.push(
          Decoration.line({
            class: 'cm-blockquote border-l-4 border-primary/50 bg-muted/20 pl-4 py-1 my-1.5 rounded-r italic text-muted-foreground',
          }).range(line.from)
        )
      }
    },
  })

  decorations.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide)
  return Decoration.set(decorations)
}

export const livePreviewPlugin = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state)
  },
  update(decorations, tr) {
    if (tr.docChanged || tr.selection) {
      return buildDecorations(tr.state)
    }
    return decorations.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})
