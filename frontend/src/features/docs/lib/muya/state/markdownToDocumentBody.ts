import { indexDocumentBody, type DocumentBodyNode } from '../../documentBody'
import { documentBodyToMarkdown } from './documentBodyToMarkdown'
import {
  enrichMuyaStateForBodyImport,
  type MuyaBodyImportState,
} from './enrichMuyaStateForBodyImport'
import { MarkdownToState } from './markdownToState'

export interface ParsedMarkdownBody {
  bodySchemaVersion: number
  rootNodeID: string
  sourceFingerprint: string
  nodes: DocumentBodyNode[]
}

interface NodeDraft {
  parentKey: string | null
  idName: string
  siblingOrder: number
  type: string
  content: string
  attributes: Record<string, unknown>
  sourceGap?: string
  sourceMarkdown?: string
}

export async function markdownToDocumentBody(
  documentID: string,
  markdown: string,
  bodySchemaVersion = 1
): Promise<ParsedMarkdownBody> {
  if (
    !isUUID(documentID) ||
    !Number.isSafeInteger(bodySchemaVersion) ||
    bodySchemaVersion < 1
  )
    throw new Error('document ID and positive body schema version are required')

  const sourceFingerprint = toHex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(markdown))
  )
  const rootNodeID = await deterministicUUID(
    documentID,
    `muya:${bodySchemaVersion}:${sourceFingerprint}:root`
  )
  const drafts: NodeDraft[] = []
  appendStates(
    enrichMuyaStateForBodyImport(
      new MarkdownToState({
        footnote: false,
        math: true,
        isGitlabCompatibilityEnabled: false,
        trimUnnecessaryCodeBlockEmptyLines: false,
        frontMatter: true,
      }).generate(markdown)
    ),
    null,
    [],
    drafts
  )

  const nodeIDs = await Promise.all(
    drafts.map((draft) =>
      deterministicUUID(
        documentID,
        `muya:${bodySchemaVersion}:${sourceFingerprint}:${draft.idName}`
      )
    )
  )
  const idByKey = new Map(
    drafts.map((draft, index) => [draft.idName, nodeIDs[index]!])
  )
  const sourceGaps = Object.fromEntries(
    drafts.flatMap((draft, index) =>
      draft.sourceGap !== undefined ? [[nodeIDs[index]!, draft.sourceGap]] : []
    )
  )
  const sourceTables = Object.fromEntries(
    drafts.flatMap((draft, index) =>
      draft.sourceMarkdown ? [[nodeIDs[index]!, draft.sourceMarkdown]] : []
    )
  )
  const nodes: DocumentBodyNode[] = [
    {
      nodeID: rootNodeID,
      parentID: null,
      siblingOrder: 0,
      type: 'document',
      content: '',
      attributes: {
        trailingWhitespace: markdown.match(/[ \t\r\n]*$/)![0],
        ...(Object.keys(sourceGaps).length ? { sourceGaps } : {}),
        ...(Object.keys(sourceTables).length ? { sourceTables } : {}),
      },
    },
    ...drafts.map((draft, index) => ({
      nodeID: nodeIDs[index]!,
      parentID: draft.parentKey ? idByKey.get(draft.parentKey)! : rootNodeID,
      siblingOrder: draft.siblingOrder,
      type: draft.type,
      content: draft.content,
      attributes: draft.attributes,
    })),
  ]

  indexDocumentBody(nodes)
  const exportedMarkdown = documentBodyToMarkdown(nodes)
  if (exportedMarkdown !== markdown) {
    let characterOffset = 0
    while (
      characterOffset < markdown.length &&
      characterOffset < exportedMarkdown.length &&
      markdown[characterOffset] === exportedMarkdown[characterOffset]
    ) {
      characterOffset++
    }
    const sourceCode =
      markdown.codePointAt(characterOffset)?.toString(16) ?? 'EOF'
    const parsedCode =
      exportedMarkdown.codePointAt(characterOffset)?.toString(16) ?? 'EOF'
    throw new Error(
      `Markdown source cannot be imported without changing its text at character ${characterOffset} (source U+${sourceCode}, parsed U+${parsedCode}; source length ${markdown.length}, parsed length ${exportedMarkdown.length})`
    )
  }
  return { bodySchemaVersion, rootNodeID, sourceFingerprint, nodes }
}

function appendStates(
  states: MuyaBodyImportState[],
  parentKey: string | null,
  parentPath: number[],
  drafts: NodeDraft[]
) {
  states.forEach((state, siblingOrder) => {
    const path = [...parentPath, siblingOrder]
    const pathKey = path.join('/')
    const key = `${pathKey}:${state.name}`
    drafts.push({
      parentKey,
      idName: key,
      siblingOrder,
      type: state.name,
      content: state.inline === undefined ? (state.text ?? '') : '',
      attributes: state.meta ? { ...state.meta } : {},
      ...(state.sourceGap !== undefined ? { sourceGap: state.sourceGap } : {}),
      ...(state.sourceMarkdown ? { sourceMarkdown: state.sourceMarkdown } : {}),
    })

    state.inline?.forEach((inline, inlineOrder) => {
      const inlinePath = [...path, inlineOrder]
      const inlineKey = `${inlinePath.join('/')}:${inline.type}`
      drafts.push({
        parentKey: key,
        idName: inlineKey,
        siblingOrder: inlineOrder,
        type: inline.type,
        content: 'content' in inline ? inline.content : '',
        attributes: { ...inline.attributes },
      })
    })

    if (state.children) appendStates(state.children, key, path, drafts)
  })
}

async function deterministicUUID(namespace: string, name: string) {
  const namespaceBytes = fromHex(namespace.replaceAll('-', ''))
  const nameBytes = new TextEncoder().encode(name)
  const input = new Uint8Array(namespaceBytes.length + nameBytes.length)
  input.set(namespaceBytes)
  input.set(nameBytes, namespaceBytes.length)
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-1', input)
  ).slice(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = toHex(bytes)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function isUUID(value: string) {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
}

function fromHex(value: string) {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16)
  )
}

function toHex(value: ArrayBuffer | Uint8Array) {
  return Array.from(
    value instanceof Uint8Array ? value : new Uint8Array(value),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('')
}
