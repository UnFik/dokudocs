import React from 'react'

const PAIR_MAP: Record<string, string> = {
  "'": "'",
  '"': '"',
  '`': '`',
  '(': ')',
  '[': ']',
  '{': '}',
  '<': '>',
}

const CLOSING_MAP: Record<string, string> = {
  ')': '(',
  ']': '[',
  '}': '{',
  '>': '<',
}

const AUTO_EXPAND_PAIRS = new Set(['{}', '[]', '()'])

export function handleEditorPairingKeyDown(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  textarea: HTMLTextAreaElement,
  onChange: (newContent: string, cursorStart?: number, cursorEnd?: number) => void
): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) {
    return false
  }

  const { selectionStart: start, selectionEnd: end, value: text } = textarea
  const key = e.key

  if (start !== end) {
    let openChar = ''
    let closeChar = ''

    if (PAIR_MAP[key]) {
      openChar = key
      closeChar = PAIR_MAP[key]
    } else if (CLOSING_MAP[key]) {
      openChar = CLOSING_MAP[key]
      closeChar = key
    }

    if (openChar && closeChar) {
      e.preventDefault()
      const selectedText = text.substring(start, end)
      const newContent =
        text.substring(0, start) +
        openChar +
        selectedText +
        closeChar +
        text.substring(end)
      const nextStart = start + openChar.length
      const nextEnd = end + openChar.length
      onChange(newContent, nextStart, nextEnd)
      return true
    }

    return false
  }

  if (key === 'Backspace' && start > 0) {
    const prevChar = text[start - 1]
    const nextChar = text[start]
    if (PAIR_MAP[prevChar] && PAIR_MAP[prevChar] === nextChar) {
      e.preventDefault()
      const newContent = text.substring(0, start - 1) + text.substring(start + 1)
      onChange(newContent, start - 1, start - 1)
      return true
    }
    return false
  }

  if (key === 'Enter' && start > 0 && start < text.length) {
    const prevChar = text[start - 1]
    const nextChar = text[start]
    const pair = prevChar + nextChar
    if (AUTO_EXPAND_PAIRS.has(pair)) {
      e.preventDefault()
      const lineStart = text.lastIndexOf('\n', start - 2) + 1
      const currentLine = text.substring(lineStart, start - 1)
      const matchIndent = currentLine.match(/^\s*/)
      const baseIndent = matchIndent ? matchIndent[0] : ''
      const innerIndent = baseIndent + '  '
      const insertion = '\n' + innerIndent + '\n' + baseIndent
      const newContent = text.substring(0, start) + insertion + text.substring(start)
      const targetPos = start + 1 + innerIndent.length
      onChange(newContent, targetPos, targetPos)
      return true
    }
    return false
  }

  if (
    key === ')' ||
    key === ']' ||
    key === '}' ||
    key === '>' ||
    key === "'" ||
    key === '"' ||
    key === '`'
  ) {
    const nextChar = text[start]
    if (nextChar === key) {
      e.preventDefault()
      const nextPos = start + 1
      textarea.setSelectionRange(nextPos, nextPos)
      return true
    }
  }

  if (PAIR_MAP[key]) {
    const closeChar = PAIR_MAP[key]
    const nextChar = text[start]

    if (key === "'" || key === '"' || key === '`') {
      if (nextChar && /\w/.test(nextChar)) {
        return false
      }
    }

    e.preventDefault()
    const newContent =
      text.substring(0, start) + key + closeChar + text.substring(start)
    const nextPos = start + key.length
    onChange(newContent, nextPos, nextPos)
    return true
  }

  return false
}
