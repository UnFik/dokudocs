const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const DOC_SCHEME = new RegExp(`^doc:(${UUID})$`, 'i')
const DOC_PATH = new RegExp(`^/docs/(${UUID})(?:[?#].*)?$`, 'i')
const OUTSIDE = /^(https?:|mailto:)/i

export type AnswerLink =
  | { kind: 'external'; href: string }
  | { kind: 'document'; id: string }
  | { kind: 'none' }

/**
 * What a link in an answer may do. Outside addresses open in a new tab; a
 * document is named by `doc:<id>` or an in-app path; everything else (script,
 * data and file addresses, other paths) is not a link and shows as text.
 */
export function classifyHref(href: string): AnswerLink {
  const value = href.trim()
  const document = DOC_SCHEME.exec(value) ?? DOC_PATH.exec(value)
  if (document) return { kind: 'document', id: document[1].toLowerCase() }
  if (OUTSIDE.test(value)) return { kind: 'external', href: value }
  return { kind: 'none' }
}
