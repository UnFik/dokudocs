import { InputRule } from 'prosemirror-inputrules'
import type { EditorState } from 'prosemirror-state'
import { documentBodySchema } from './documentBody'

// Typographic replacements as you type, off unless the person turns them on:
// curly quotes, an ellipsis, arrows and a few symbols. Never inside code.

const code = documentBodySchema.marks.code!

function inCode(state: EditorState) {
  const marks = state.storedMarks ?? state.selection.$from.marks()
  return marks.some((mark) => mark.type === code)
}

function replace(
  enabled: () => boolean,
  find: RegExp,
  text: (match: RegExpMatchArray) => string
) {
  return new InputRule(find, (state, match, start, end) => {
    if (!enabled() || inCode(state)) return null
    return state.tr.insertText(text(match), start, end)
  })
}

export function smartTextRules(enabled: () => boolean) {
  return [
    replace(enabled, /\.\.\.$/, () => '…'),
    replace(enabled, /->$/, () => '→'),
    replace(enabled, /<-$/, () => '←'),
    replace(enabled, /\(c\)$/i, () => '©'),
    replace(enabled, /\(tm\)$/i, () => '™'),
    replace(enabled, /\(r\)$/i, () => '®'),
    // A quote opens after a space, an opening bracket or the start of the text, and closes otherwise.
    replace(enabled, /(?:^|[\s{[(<'‘“])(")$/, (m) => m[0]!.slice(0, -1) + '“'),
    replace(enabled, /"$/, () => '”'),
    replace(enabled, /(?:^|[\s{[(<"‘“])(')$/, (m) => m[0]!.slice(0, -1) + '‘'),
    replace(enabled, /'$/, () => '’'),
  ]
}
