export type Suggestion = { id: string; author: string }

type JSONNode = { content?: JSONNode[]; marks?: { type: string; attrs?: { id?: unknown; author?: unknown } }[] }

const kinds = new Set(['suggestion_insert', 'suggestion_delete', 'suggestion_format'])

/** The suggestions carried by marks anywhere in the document, each once. */
export function suggestionsIn(json: unknown): Suggestion[] {
  const found = new Map<string, Suggestion>()
  const visit = (node: JSONNode) => {
    for (const mark of node.marks ?? []) {
      const { id, author } = mark.attrs ?? {}
      if (kinds.has(mark.type) && typeof id === 'string' && typeof author === 'string' && !found.has(id))
        found.set(id, { id, author })
    }
    for (const child of node.content ?? []) visit(child)
  }
  visit(json as JSONNode)
  return [...found.values()]
}
