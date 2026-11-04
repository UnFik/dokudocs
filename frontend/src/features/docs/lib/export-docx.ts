import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
  type ILevelsOptions,
  type INumberingOptions,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx'
import type { Token, Tokens } from 'marked'
import { assetObjectURL } from './assets'
import {
  downloadBlob,
  exportFileName,
  type ExportContext,
} from './export-document'
import { markdownTokens } from './render-markdown'

// A Word file cannot hold what a browser can draw for the page (equations from TeX,
// folded blocks, diagrams from source), so each of those has a plain form, and
// nothing in the document is left out: what has no equivalent is written as text.

type RunStyle = {
  bold?: boolean
  italics?: boolean
  strike?: boolean
  code?: boolean
}

/** An image already decoded to PNG, with the size it is shown at, in pixels. */
type Picture = { data: Uint8Array; width: number; height: number }

/** What one export keeps while it walks the document. */
type Build = {
  lists: INumberingOptions['config'][number][]
  /** The pictures fetched or drawn beforehand, by the token that asked for them. */
  pictures: Map<Token, Picture>
  /** What every paragraph written under it carries, such as a quote's edge. */
  paragraph?: IParagraphOptions
}

type NoticeToken = Token & { variant: string; tokens: Token[] }
type ToggleToken = Token & { title: string; tokens: Token[] }
type MathBlockToken = Token & { text: string }

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
]

const MONOSPACE = 'Consolas'
const MAX_PICTURE_WIDTH = 600
const BULLETS = ['•', '◦', '▪']
const RULE = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' }
const NOTICE_FILL: Record<string, string> = {
  info: 'DBEAFE',
  success: 'DCFCE7',
  warning: 'FEF3C7',
  tip: 'EDE9FE',
}
const PAGE_BREAK = /^\s*<div class="page-break">\s*<\/div>\s*$/

/**
 * Marked writes HTML entities into the text it hands back; the file wants the characters.
 * The `<body>` keeps the parser from dropping the spaces a text starts with.
 */
function plain(text: string): string {
  return (
    new DOMParser().parseFromString(`<!doctype html><body>${text}`, 'text/html')
      .body.textContent ?? ''
  )
}

function run(text: string, style: RunStyle = {}) {
  return new TextRun({
    text,
    bold: style.bold,
    italics: style.italics,
    strike: style.strike,
    font: style.code ? MONOSPACE : undefined,
  })
}

function paragraph(build: Build, options: IParagraphOptions) {
  return new Paragraph({ ...build.paragraph, ...options })
}

function imageRun(picture: Picture, alt: string) {
  const width = Math.min(picture.width, MAX_PICTURE_WIDTH)
  return new ImageRun({
    type: 'png',
    data: picture.data,
    transformation: {
      width,
      height: Math.round((picture.height * width) / picture.width),
    },
    altText: { name: 'image', title: alt, description: alt },
  })
}

function inlines(
  tokens: Token[] | undefined,
  build: Build,
  style: RunStyle = {}
): ParagraphChild[] {
  return (tokens ?? []).flatMap((token): ParagraphChild[] => {
    switch (token.type) {
      case 'strong':
        return inlines((token as Tokens.Strong).tokens, build, {
          ...style,
          bold: true,
        })
      case 'em':
        return inlines((token as Tokens.Em).tokens, build, {
          ...style,
          italics: true,
        })
      case 'del':
        return inlines((token as Tokens.Del).tokens, build, {
          ...style,
          strike: true,
        })
      case 'codespan':
        return [
          run(plain((token as Tokens.Codespan).text), { ...style, code: true }),
        ]
      case 'link': {
        const link = token as Tokens.Link
        return [
          new ExternalHyperlink({
            link: link.href,
            children: inlines(link.tokens, build, style) as TextRun[],
          }),
        ]
      }
      case 'image': {
        const image = token as Tokens.Image
        const picture = build.pictures.get(token)
        return [
          picture
            ? imageRun(picture, image.text)
            : run(plain(image.text), style),
        ]
      }
      case 'br':
        return [new TextRun({ break: 1 })]
      case 'text': {
        const text = token as Tokens.Text
        return text.tokens
          ? inlines(text.tokens, build, style)
          : [run(plain(text.text), style)]
      }
      case 'mathInline':
        // Word has no equation to put a TeX formula in; its source is what the document says.
        return [run(token.raw, { ...style, code: true })]
      case 'html':
        // A tag is not text; what sits between two of them is, and is its own token.
        return /^<br\s*\/?>$/i.test(token.raw.trim())
          ? [new TextRun({ break: 1 })]
          : []
      default:
        // Whatever this does not know is still the document's text.
        return [run(plain(token.raw), style)]
    }
  })
}

function levels(ordered: boolean): ILevelsOptions[] {
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    format: ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
    text: ordered ? `%${level + 1}.` : BULLETS[level % BULLETS.length]!,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }))
}

/** A bullet list shares one numbering; every numbered list gets its own, so it starts at one. */
function startList(build: Build, ordered: boolean): string {
  const reference = ordered ? `ordered-${build.lists.length}` : 'bullets'
  if (!build.lists.some((list) => list.reference === reference))
    build.lists.push({ reference, levels: levels(ordered) })
  return reference
}

function listItems(
  list: Tokens.List,
  reference: string,
  level: number,
  build: Build
): FileChild[] {
  return list.items.flatMap((item): FileChild[] => {
    const marker = item.task ? [run(item.checked ? '☑ ' : '☐ ')] : []
    const children: FileChild[] = []
    let first = true
    for (const token of item.tokens) {
      if (token.type === 'list') {
        const nested = token as Tokens.List
        children.push(
          ...listItems(
            nested,
            startList(build, nested.ordered),
            level + 1,
            build
          )
        )
      } else if (
        first &&
        (token.type === 'text' || token.type === 'paragraph')
      ) {
        const content = token as Tokens.Text | Tokens.Paragraph
        children.unshift(
          paragraph(build, {
            numbering: { reference, level },
            children: [...marker, ...inlines(content.tokens, build)],
          })
        )
        first = false
      } else {
        children.push(...blocks([token], build))
      }
    }
    return children
  })
}

function table(token: Tokens.Table, build: Build): Table {
  const alignment = (align: string | null) =>
    align === 'right'
      ? AlignmentType.RIGHT
      : align === 'center'
        ? AlignmentType.CENTER
        : AlignmentType.LEFT
  const row = (cells: Tokens.TableCell[], header: boolean) =>
    new TableRow({
      tableHeader: header,
      children: cells.map(
        (cell) =>
          new TableCell({
            children: [
              paragraph(build, {
                alignment: alignment(cell.align),
                children: inlines(cell.tokens, build, { bold: header }),
              }),
            ],
          })
      ),
    })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: RULE,
      bottom: RULE,
      left: RULE,
      right: RULE,
      insideHorizontal: RULE,
      insideVertical: RULE,
    },
    rows: [
      row(token.header, true),
      ...token.rows.map((cells) => row(cells, false)),
    ],
  })
}

/** A one-cell table: shaded, with its kind on the first line, so it reads as a notice. */
function notice(token: NoticeToken, build: Build): Table {
  const label = token.variant.charAt(0).toUpperCase() + token.variant.slice(1)
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { fill: NOTICE_FILL[token.variant] ?? 'F6F8FA' },
            children: [
              paragraph(build, { children: [run(label, { bold: true })] }),
              ...(blocks(token.tokens, build) as (Paragraph | Table)[]),
            ],
          }),
        ],
      }),
    ],
  })
}

/** One shaded monospace paragraph a line, so the indentation of each line is kept. */
function code(text: string, build: Build): Paragraph[] {
  return text.split('\n').map((line) =>
    paragraph(build, {
      spacing: { after: 0 },
      shading: { fill: 'F6F8FA' },
      children: [run(line, { code: true })],
    })
  )
}

/** A page break is one; any other raw HTML keeps its text and loses its tags. */
function htmlBlock(source: string, build: Build): Paragraph[] {
  if (PAGE_BREAK.test(source))
    return [paragraph(build, { children: [new PageBreak()] })]
  const text = new DOMParser()
    .parseFromString(`<!doctype html><body>${source}`, 'text/html')
    .body.textContent?.trim()
  return text ? [paragraph(build, { children: [run(text)] })] : []
}

function blocks(tokens: Token[], build: Build): FileChild[] {
  return tokens.flatMap((token): FileChild[] => {
    switch (token.type) {
      case 'space':
        return []
      case 'heading': {
        const heading = token as Tokens.Heading
        return [
          paragraph(build, {
            heading: HEADINGS[heading.depth - 1],
            children: inlines(heading.tokens, build),
          }),
        ]
      }
      case 'paragraph':
        return [
          paragraph(build, {
            children: inlines((token as Tokens.Paragraph).tokens, build),
          }),
        ]
      case 'list': {
        const list = token as Tokens.List
        return listItems(list, startList(build, list.ordered), 0, build)
      }
      case 'table':
        return [table(token as Tokens.Table, build)]
      case 'code': {
        const block = token as Tokens.Code
        const picture = build.pictures.get(token)
        return picture
          ? [paragraph(build, { children: [imageRun(picture, 'Diagram')] })]
          : code(block.text, build)
      }
      case 'blockquote':
        return blocks((token as Tokens.Blockquote).tokens, {
          ...build,
          paragraph: {
            ...build.paragraph,
            indent: { left: 360 },
            border: {
              left: {
                style: BorderStyle.SINGLE,
                size: 18,
                space: 8,
                color: 'BFBFBF',
              },
            },
          },
        })
      case 'hr':
        return [
          paragraph(build, {
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 6,
                space: 1,
                color: 'BFBFBF',
              },
            },
          }),
        ]
      case 'html':
        return htmlBlock((token as Tokens.HTML).text, build)
      case 'notice':
        return [notice(token as NoticeToken, build)]
      case 'toggle': {
        // Printed open: the title, then what it holds.
        const toggle = token as ToggleToken
        return [
          paragraph(build, {
            children: [run(plain(toggle.title), { bold: true })],
          }),
          ...blocks(toggle.tokens, build),
        ]
      }
      case 'mathBlock':
        return code(`$$\n${(token as MathBlockToken).text}\n$$`, build)
      default:
        return [paragraph(build, { children: [run(plain(token.raw))] })]
    }
  })
}

/** Every token under `tokens`, however deep: paragraphs, list items, table cells, notices. */
function* walk(tokens: Token[]): Generator<Token> {
  for (const token of tokens) {
    yield token
    const inner = token as Token & {
      tokens?: Token[]
      items?: { tokens: Token[] }[]
      header?: { tokens: Token[] }[]
      rows?: { tokens: Token[] }[][]
    }
    if (inner.tokens) yield* walk(inner.tokens)
    for (const item of inner.items ?? []) yield* walk(item.tokens)
    for (const cell of inner.header ?? []) yield* walk(cell.tokens)
    for (const row of inner.rows ?? [])
      for (const cell of row) yield* walk(cell.tokens)
  }
}

/** Draws a blob onto a canvas and reads it back as PNG, which Word reads whatever the source was. */
async function toPicture(blob: Blob, scale = 1): Promise<Picture> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  const png = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  )
  if (!png) throw new Error('The image could not be converted')
  return {
    data: new Uint8Array(await png.arrayBuffer()),
    width: Math.round(canvas.width / scale),
    height: Math.round(canvas.height / scale),
  }
}

/** A stored image, read with the reader's own session. One on another host is not asked for. */
async function storedImage(
  href: string,
  workspaceID: string
): Promise<Picture> {
  if (href.startsWith('data:'))
    return toPicture(await (await fetch(href)).blob())
  if (!href.startsWith('/') || href.startsWith('//'))
    throw new Error('not a stored image')
  return toPicture(
    await (await fetch(await assetObjectURL(workspaceID, href))).blob()
  )
}

/** A Mermaid diagram drawn light, on white, at twice the size so it stays sharp. */
async function diagramPicture(source: string): Promise<Picture> {
  const { renderExportSvg, rasterizeSvg } = await import('./mermaid-export')
  const svg = await renderExportSvg(source, {
    isDark: false,
    themeName: 'default',
    background: '#ffffff',
  })
  const canvas = await rasterizeSvg(svg, 2)
  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('no image'))),
      'image/png'
    )
  )
  return toPicture(png, 2)
}

/** Fetches and draws every picture the document asks for; one that fails is left out of the map. */
async function loadPictures(
  tokens: Token[],
  workspaceID: string
): Promise<Map<Token, Picture>> {
  const pictures = new Map<Token, Picture>()
  await Promise.all(
    [...walk(tokens)].map(async (token) => {
      try {
        if (token.type === 'image')
          pictures.set(
            token,
            await storedImage((token as Tokens.Image).href, workspaceID)
          )
        else if (
          token.type === 'code' &&
          (token as Tokens.Code).lang === 'mermaid'
        )
          pictures.set(token, await diagramPicture((token as Tokens.Code).text))
      } catch {
        /* It is written as text instead: the alt text, or the diagram's source. */
      }
    })
  )
  return pictures
}

/** Builds the document as a Word file and saves it; returns the file's name. */
export async function exportDocx(context: ExportContext): Promise<string> {
  const tokens = markdownTokens(context.markdown)
  const build: Build = {
    lists: [],
    pictures: await loadPictures(tokens, context.workspaceID),
  }
  const children = blocks(tokens, build)
  const document = new Document({
    numbering: { config: build.lists },
    sections: [{ children }],
  })
  const name = exportFileName(context.title, 'docx')
  downloadBlob(await Packer.toBlob(document), name)
  return name
}
