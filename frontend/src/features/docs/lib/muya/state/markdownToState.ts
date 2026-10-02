import { firstWordOfInfo } from '../utils'
import logger from '../utils/logger'
import { lexBlock } from '../utils/marked'
import type { TBlockToken } from '../utils/marked/types'
import type {
  IAtxHeadingState,
  IBulletListState,
  IListItemState,
  IOrderListState,
  ISetextHeadingState,
  ITableState,
  ITaskListItemState,
  ITaskListState,
  TState,
} from './types'

const debug = logger('import markdown: ')

interface IMarkdownToStateOptions {
  footnote: boolean
  math: boolean
  isGitlabCompatibilityEnabled: boolean
  trimUnnecessaryCodeBlockEmptyLines: boolean
  frontMatter: boolean
}

const DEFAULT_OPTIONS = {
  footnote: false,
  math: true,
  isGitlabCompatibilityEnabled: true,
  trimUnnecessaryCodeBlockEmptyLines: false,
  frontMatter: true,
}

// Token types whose handler manipulates the `parentList` stack (push a
// container and recurse via synthetic `block-end`), as opposed to the leaf
// tokens that only append a state to the current level.
const CONTAINER_TOKEN_TYPES = new Set([
  'block-end',
  'blockquote',
  'list',
  'list_item',
  'footnote',
])

export class MarkdownToState {
  constructor(private _options: IMarkdownToStateOptions = DEFAULT_OPTIONS) {}

  generate(markdown: string): TState[] {
    return this._convertMarkdownToState(markdown)
  }

  private _convertMarkdownToState(markdown: string): TState[] {
    const {
      footnote = false,
      math = true,
      isGitlabCompatibilityEnabled = true,
      trimUnnecessaryCodeBlockEmptyLines = false,
      frontMatter = true,
    } = this._options

    // markdownToState injects synthetic `block-end` markers (see the
    // blockquote/list/list_item/footnote cases below) to pop the parent
    // stack, so the working stream is wider than what `lexBlock` returns.
    const tokens: TBlockToken[] = lexBlock(markdown, {
      footnote,
      math,
      frontMatter,
      isGitlabCompatibilityEnabled,
    })

    const states: TState[] = []
    let token: TBlockToken | undefined
    let pendingSourceGap = ''
    const parentList: TState[][] = [states]
    const sourceGapByToken = new WeakMap<object, string>()

    while ((token = tokens.shift())) {
      if (token.type === 'space') {
        pendingSourceGap += sourceGapByToken.get(token) ?? token.raw
        continue
      }
      if (token.type === 'block-end') {
        pendingSourceGap = ''
      }
      const headingIndent =
        token.type === 'heading'
          ? (token.raw.match(/^( {1,3})(?=#)/)?.[1] ?? '')
          : ''
      const sourceGap =
        (sourceGapByToken.get(token) ?? pendingSourceGap) + headingIndent
      const siblings = parentList[0]
      const previousLength = siblings.length
      if (CONTAINER_TOKEN_TYPES.has(token.type))
        this._handleContainerToken(token, parentList, tokens, sourceGapByToken)
      else
        this._handleLeafToken(
          token,
          parentList,
          tokens,
          trimUnnecessaryCodeBlockEmptyLines
        )
      if (siblings.length > previousLength) {
        if (isNonCanonicalSourceGap(sourceGap) || headingIndent) {
          siblings[siblings.length - 1]!.sourceGap = sourceGap
        } else if (
          previousLength > 0 &&
          // The front matter token swallows the blank line after it, so an
          // empty gap there is not "adjacent blocks"; keep the canonical break.
          siblings[previousLength - 1]!.name !== 'frontmatter' &&
          // Loose list items are separated by a blank line that the item
          // token does not carry, so an empty gap would drop it.
          siblings[siblings.length - 1]!.name !== 'list-item' &&
          siblings[siblings.length - 1]!.name !== 'task-list-item' &&
          sourceGap === '' &&
          !sourceGapByToken.has(token)
        ) {
          siblings[siblings.length - 1]!.sourceGap = ''
        }
        pendingSourceGap = ''
      }
    }

    return states.length ? states : [{ name: 'paragraph', text: '' }]
  }

  private _handleContainerToken(
    token: TBlockToken,
    parentList: TState[][],
    tokens: TBlockToken[],
    sourceGapByToken: WeakMap<object, string>
  ) {
    let state: TState
    switch (token.type) {
      // Marks the end of the children's traversal and a return to the previous level
      case 'block-end': {
        // Fix #1735 the blockquote maybe empty. like bellow:
        // >
        // bar
        if (
          parentList[0].length === 0 &&
          (token.tokenType === 'blockquote' || token.tokenType === 'list-item')
        ) {
          state = {
            name: 'paragraph' as const,
            text: '',
          }
          parentList[0].push(state)
        }
        parentList.shift()
        break
      }

      case 'blockquote': {
        addBlockquoteGapWhitespace(
          token.raw,
          token.tokens as TBlockToken[],
          sourceGapByToken
        )
        state = {
          name: 'block-quote' as const,
          children: [],
        }
        parentList[0].push(state)
        parentList.unshift(state.children)
        tokens.unshift({ type: 'block-end', tokenType: 'blockquote' })
        tokens.unshift(...(token.tokens as TBlockToken[]))
        break
      }

      case 'list': {
        const { listType, loose, start } = token
        const bulletMarkerOrDelimiter = token.items[0].bulletMarkerOrDelimiter

        let listState: IOrderListState | IBulletListState | ITaskListState
        if (listType === 'order') {
          listState = {
            name: 'order-list',
            meta: {
              loose,
              start: /^\d+$/.test(String(start)) ? Number(start) : 1,
              delimiter: bulletMarkerOrDelimiter || '.',
            },
            children: [],
          }
        } else if (listType === 'task') {
          listState = {
            name: 'task-list',
            meta: {
              loose,
              marker: bulletMarkerOrDelimiter || '-',
            },
            children: [],
          }
        } else {
          listState = {
            name: 'bullet-list',
            meta: {
              loose,
              marker: bulletMarkerOrDelimiter || '-',
            },
            children: [],
          }
        }

        state = listState
        parentList[0].push(state)
        parentList.unshift(state.children)
        tokens.unshift({ type: 'block-end', tokenType: 'list' })
        const items = token.items as TBlockToken[]
        items.forEach((item, index) => {
          if (index === 0 || sourceGapByToken.has(item)) return
          const previousItem = items[index - 1]!
          if (!('raw' in previousItem)) return
          const sourceGap = previousItem.raw.match(/[ \t\r\n]+$/)?.[0]
          // Canonical gaps are recorded too, so a loose item that follows a
          // blank line is not mistaken for an item glued to its neighbour.
          if (sourceGap) sourceGapByToken.set(item, sourceGap)
        })
        tokens.unshift(...items)
        break
      }

      case 'list_item': {
        const { listItemType, checked } = token
        let itemState: IListItemState | ITaskListItemState
        if (listItemType === 'task') {
          itemState = {
            name: 'task-list-item',
            meta: { checked: Boolean(checked) },
            children: [],
          }
        } else {
          itemState = {
            name: 'list-item',
            children: [],
          }
        }

        state = itemState
        parentList[0].push(state)
        parentList.unshift(state.children)
        tokens.unshift({ type: 'block-end', tokenType: 'list-item' })
        tokens.unshift(...(token.tokens as TBlockToken[]))
        break
      }

      case 'footnote': {
        // The footnote extension (utils/marked/extensions/footnote.ts)
        // emits a parent token whose `tokens` array holds nested
        // block tokens. Mirror that into a `footnote` container
        // state and recurse via tokens.unshift / block-end.
        const { identifier } = token
        state = {
          name: 'footnote' as const,
          meta: { identifier },
          children: [],
        }
        parentList[0].push(state)
        parentList.unshift(state.children)
        tokens.unshift({ type: 'block-end', tokenType: 'footnote' })
        tokens.unshift(...(token.tokens as TBlockToken[]))
        break
      }
    }
  }

  private _handleLeafToken(
    token: TBlockToken,
    parentList: TState[][],
    tokens: TBlockToken[],
    trimUnnecessaryCodeBlockEmptyLines: boolean
  ) {
    let state: TState
    let value: string
    switch (token.type) {
      case 'frontmatter': {
        const { lang, style, text } = token
        value = text.replace(/^\s+/, '').replace(/\s$/, '')

        state = {
          name: 'frontmatter' as const,
          meta: {
            lang,
            style,
          },
          text: value,
        }

        parentList[0].push(state)
        break
      }

      case 'hr': {
        state = {
          name: 'thematic-break' as const,
          text: token.raw.replace(/\n+$/, ''),
        }

        parentList[0].push(state)
        break
      }

      case 'heading': {
        const { headingStyle, depth, text, marker } = token
        value = headingStyle === 'atx' ? `${'#'.repeat(+depth)} ${text}` : text

        if (headingStyle === 'atx') {
          const atxState: IAtxHeadingState = {
            name: 'atx-heading',
            meta: { level: depth },
            text: value,
          }
          state = atxState
        } else {
          const setextState: ISetextHeadingState = {
            name: 'setext-heading',
            meta: { level: depth, underline: marker },
            text: value,
          }
          state = setextState
        }

        parentList[0].push(state)
        break
      }

      case 'code': {
        const { codeBlockStyle, text, lang: infoString = '', raw = '' } = token
        // marked >=17 appends a trailing newline to indented code text
        // (fenced text has none); strip it so indented blocks round-trip.
        const codeText =
          codeBlockStyle === 'indented' ? text.replace(/\n$/, '') : text
        const fenceLength = /^ {0,3}([`~]{3,})/.exec(raw)?.[1].length
        parentList[0].push(
          this._buildCodeState(
            codeText,
            infoString,
            codeBlockStyle,
            trimUnnecessaryCodeBlockEmptyLines,
            fenceLength
          )
        )
        break
      }

      case 'table': {
        const { header, align, rows, raw } = token
        const tableState: ITableState = {
          name: 'table',
          sourceMarkdown: raw.replace(/(?:\r\n|\r|\n)+$/, ''),
          children: [],
        }

        // Store the cell text as marked emits it (with the table `\|`
        // escape already resolved to a literal `|`), so the editor shows
        // `` `|` `` rather than the escaped `` `\|` `` inside inline code
        // (#4849). `escapeText` re-adds the `\|` escape on serialization,
        // keeping the markdown round-trip intact.
        tableState.children.push({
          name: 'table.row',
          children: header.map((h, i) => ({
            name: 'table.cell' as const,
            meta: { align: align[i] || 'none' },
            text: h.text,
          })),
        })

        tableState.children.push(
          ...rows.map((row) => ({
            name: 'table.row' as const,
            children: row.map((c, i) => ({
              name: 'table.cell' as const,
              meta: { align: align[i] || 'none' },
              text: c.text,
            })),
          }))
        )

        state = tableState
        parentList[0].push(state)
        break
      }

      case 'html': {
        const text = token.text.trim()
        // TODO: Treat html state which only contains one img as paragraph, we maybe add image state in the future.
        const isSingleImage = /^<img[^<>]+>$/.test(text)
        if (isSingleImage) {
          state = {
            name: 'paragraph' as const,
            text,
          }
          parentList[0].push(state)
        } else {
          state = {
            name: 'html-block' as const,
            text,
          }
          parentList[0].push(state)
        }
        break
      }

      case 'multiplemath': {
        const text = token.text.trim()
        const { mathStyle = '' } = token
        const state = {
          name: 'math-block' as const,
          text,
          meta: { mathStyle },
        }
        parentList[0].push(state)
        break
      }

      case 'text': {
        value = token.text
        while (tokens[0]?.type === 'text') {
          const next = tokens.shift() as Extract<TBlockToken, { type: 'text' }>
          value += `\n${next.text}`
        }
        state = {
          name: 'paragraph',
          text: value,
        }
        parentList[0].push(state)
        break
      }

      case 'paragraph': {
        value = token.text
        state = {
          name: 'paragraph' as const,
          text: value,
        }
        parentList[0].push(state)
        break
      }

      case 'space': {
        break
      }

      case 'def': {
        // Marked v16 hoists `[label]: url "title"` reference
        // definitions to block-level `def` tokens. Lower them back
        // to paragraph state nodes so the rest of the pipeline —
        // `InlineRenderer.collectReferenceDefinitions` (regex scan
        // over paragraph text) and round-trip serialization —
        // keeps working without a dedicated state node.
        // Aligns with marktext's "definition is paragraph text"
        // model. See plan section 13 (PR-16).
        state = {
          name: 'paragraph' as const,
          text: token.raw.replace(/\n+$/, ''),
        }
        parentList[0].push(state)
        break
      }

      default:
        debug.warn(`Unknown type ${token.type}`)
        break
    }
  }

  private _buildCodeState(
    text: string,
    infoString: string,
    codeBlockStyle: 'indented' | undefined,
    trimUnnecessaryCodeBlockEmptyLines: boolean,
    fenceLength?: number
  ): TState {
    // Keep the whole info string; the language for highlighting / diagram
    // detection is its first word (CommonMark §4.5).
    const info = (infoString || '').trim()
    const lang = firstWordOfInfo(info)

    let value = text
    // Fix: #1265.
    if (
      trimUnnecessaryCodeBlockEmptyLines &&
      (value.endsWith('\n') || value.startsWith('\n'))
    ) {
      value = value.replace(/\n+$/, '').replace(/^\n+/, '')
    }

    const diagramMatch =
      /^(mermaid|vega-lite|plantuml|flowchart|sequence)$/.exec(lang)
    if (diagramMatch) {
      const diagramType = diagramMatch[1] as
        | 'mermaid'
        | 'vega-lite'
        | 'plantuml'
        | 'flowchart'
        | 'sequence'
      return {
        name: 'diagram' as const,
        text: value,
        meta: {
          type: diagramType,
          lang: diagramType === 'vega-lite' ? 'json' : 'yaml',
        },
      }
    }

    // walkTokens (utils/marked/walkTokens.ts) writes
    // codeBlockStyle = 'fenced' for fenced blocks and
    // leaves 'indented' for indented blocks. marked's
    // type widens the field to `'indented' | undefined`,
    // but `'fenced'` reaches us at runtime via the
    // walkTokens assignment — hence the cast.
    const isFenced =
      (codeBlockStyle as 'indented' | 'fenced' | undefined) === 'fenced'
    return {
      name: 'code-block' as const,
      meta: {
        type: isFenced ? 'fenced' : 'indented',
        // The full info string verbatim (empty for indented blocks); the
        // language is its first word — see `firstWordOfInfo`.
        lang: info,
        ...(isFenced && fenceLength && fenceLength > 3 ? { fenceLength } : {}),
      },
      text: value,
    }
  }
}

function isNonCanonicalSourceGap(
  sourceGap: string | undefined
): sourceGap is string {
  if (!sourceGap || !/^[ \t\r\n]+$/.test(sourceGap)) return false
  const lineBreaks = sourceGap.match(/\r\n|\r|\n/g)?.length ?? 0
  return lineBreaks >= 2 && sourceGap !== '\n\n'
}

function addBlockquoteGapWhitespace(
  raw: string,
  tokens: TBlockToken[],
  sourceGapByToken: WeakMap<object, string>
) {
  const blankLineWhitespace = raw
    .split(/\r\n|\r|\n/)
    .flatMap((line) =>
      /^ {0,3}>[ \t]*$/.test(line) ? [line.slice(line.indexOf('>') + 1)] : []
    )
  let nextBlankLine = 0
  const preserveGap = (target: object, rawGap: string) => {
    const lineBreaks = rawGap.match(/\r\n|\r|\n/g)?.length ?? 0
    const blankLines = Math.max(0, lineBreaks - 1)
    const whitespace = blankLineWhitespace.slice(
      nextBlankLine,
      nextBlankLine + blankLines
    )
    nextBlankLine += blankLines
    if (!whitespace.length) return

    const endings = [...rawGap.matchAll(/\r\n|\r|\n/g)]
    const segments = rawGap.split(/\r\n|\r|\n/)
    let sourceGap = segments[0] ?? ''
    endings.forEach((ending, index) => {
      sourceGap += ending[0]
      if (index < endings.length - 1)
        sourceGap += whitespace[index] ?? segments[index + 1] ?? ''
    })
    sourceGapByToken.set(target, sourceGap)
  }
  const visit = (children: TBlockToken[]) => {
    for (const token of children) {
      if (token.type === 'space') preserveGap(token, token.raw)
      else if (token.type === 'list') {
        const items = token.items as TBlockToken[]
        for (let index = 1; index < items.length; index++) {
          const previous = items[index - 1]!
          if ('raw' in previous)
            preserveGap(
              items[index]!,
              previous.raw.match(/[ \t\r\n]+$/)?.[0] ?? ''
            )
        }
        for (const item of items)
          visit('tokens' in item ? ((item.tokens ?? []) as TBlockToken[]) : [])
      } else if (token.type !== 'blockquote' && 'tokens' in token)
        visit((token.tokens ?? []) as TBlockToken[])
    }
  }
  visit(tokens)
}
