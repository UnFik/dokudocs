import { InputRule } from 'prosemirror-inputrules'
import type { MarkType } from 'prosemirror-model'
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state'
import { documentBodySchema } from './documentBody'
import { normalizeLinkTarget } from './inlineMarks'

// Typing Markdown as you go. Inline marks only add a mark to text that is
// already in a run, so they are ordinary edits. Block rules, which change what a
// line is, are in `markdownBlockRules.ts`.

const marks = documentBodySchema.marks

const markRuleFired = new PluginKey('markdownMarkRuleFired')

/**
 * A rule turns the mark off for what is typed next by clearing the stored marks,
 * but the editor splits runs by mark in the same transaction, and any step added
 * to a transaction resets its stored marks. So they are cleared again in a
 * transaction of their own, once the rule's has been applied.
 */
export const markRuleResetPlugin = new Plugin({
  key: markRuleFired,
  appendTransaction(transactions, _old, state) {
    if (!transactions.some((tr) => tr.getMeta(markRuleFired))) return null
    return state.tr.setStoredMarks([]).setMeta('addToHistory', false)
  },
})

type MarkRule = {
  /** The text before the caret, ending in the closing delimiter. The last character is the one being typed. */
  find: RegExp
  mark: MarkType
  /** How many characters of the delimiter open and close the text. */
  delimiter: number
}

const rules: MarkRule[] = [
  // Strong: **text** and __text__.
  {
    find: /(?<![*\\])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/,
    mark: marks.strong!,
    delimiter: 2,
  },
  {
    find: /(?<![_\w\\])__([^_\s](?:[^_]*[^_\s])?)__$/,
    mark: marks.strong!,
    delimiter: 2,
  },
  // Emphasis: *text* and _text_, never inside a word for the underscore.
  {
    find: /(?<![*\w\\])\*([^*\s](?:[^*]*[^*\s])?)\*$/,
    mark: marks.em!,
    delimiter: 1,
  },
  {
    find: /(?<![_\w\\])_([^_\s](?:[^_]*[^_\s])?)_$/,
    mark: marks.em!,
    delimiter: 1,
  },
  // Strikethrough: ~~text~~.
  {
    find: /(?<![~\\])~~([^~\s](?:[^~]*[^~\s])?)~~$/,
    mark: marks.strike!,
    delimiter: 2,
  },
  // Highlight: ==text==.
  {
    find: /(?<![=\\])==([^=\s](?:[^=]*[^=\s])?)==$/,
    mark: marks.highlight!,
    delimiter: 2,
  },
  // Code: `text`.
  {
    find: /(?<![`\\])`([^`\s](?:[^`]*[^`\s])?)`$/,
    mark: marks.code!,
    delimiter: 1,
  },
]

/**
 * Whether the text at `start` can carry the mark. It is in a run once a line has
 * one; the first keys typed on an empty line are plain text in the paragraph
 * until the editor wraps them, and rules must work there too.
 */
function canMark(state: EditorState, start: number, mark: MarkType) {
  const parent = state.doc.resolve(start).parent
  return parent.inlineContent && parent.type.allowsMarkType(mark)
}

/**
 * The text between the delimiters keeps its place and gets the mark; the
 * delimiters go. The caret ends up after the marked text with the mark off, so
 * what is typed next is plain again.
 */
function markRule({ find, mark, delimiter }: MarkRule) {
  return new InputRule(find, (state, match, start, end) => {
    if (!canMark(state, start, mark)) return null
    const inner = match[1]!
    // Text already in code is literal.
    if (state.doc.rangeHasMark(start, end, marks.code!)) return null
    const tr = state.tr
    // The closing delimiter has all but its last character in the document: the
    // last one is the key being pressed, which the rule consumes.
    tr.delete(end - (delimiter - 1), end)
    tr.delete(start, start + delimiter)
    const markedTo = start + inner.length
    tr.addMark(start, markedTo, mark.create())
    tr.removeStoredMark(mark)
    tr.setMeta(markRuleFired, true)
    return tr
  })
}

/** [text](address): the text becomes a link when the address is safe. */
const linkRule = new InputRule(
  /(?<![\\!])\[([^\]\n]+)\]\(([^)\s]+)\)$/,
  (state, match, start, end) => {
    if (!canMark(state, start, marks.link!)) return null
    const href = normalizeLinkTarget(match[2]!)
    if (!href) return null
    const label = match[1]!
    const tr = state.tr
    // Everything after the label, except the ")" being typed, goes.
    tr.delete(start + 1 + label.length, end)
    tr.delete(start, start + 1)
    tr.addMark(start, start + label.length, marks.link!.create({ href }))
    tr.removeStoredMark(marks.link!)
    tr.setMeta(markRuleFired, true)
    return tr
  }
)

export const inlineMarkdownRules = [...rules.map(markRule), linkRule]
