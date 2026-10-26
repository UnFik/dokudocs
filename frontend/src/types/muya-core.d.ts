declare module '@muyajs/core' {
  export interface ILocale {
    name: string
    resource: Record<string, string>
  }

  export const en: ILocale
  export const de: ILocale
  export const es: ILocale
  export const fr: ILocale
  export const ja: ILocale
  export const ko: ILocale
  export const pt: ILocale
  export const tr: ILocale
  export const zhCN: ILocale
  export const zhTW: ILocale

  export interface ITocItem {
    content: string
    lvl: number
    slug: string
    githubSlug: string
  }

  export interface IMuyaNode {
    id: string
    text?: string
    isContent(): boolean
  }

  export class Muya {
    static use(plugin: unknown, options?: Record<string, unknown>): void
    constructor(element: HTMLElement, options?: Record<string, unknown>)
    editor: {
      scrollPage?: {
        breadthFirstTraverse(visit: (node: IMuyaNode) => void): void
      }
    }
    init(): void
    getMarkdown(): string
    replaceContent(content: string): void
    getTOC(): ITocItem[]
    getReadOnly(): boolean
    setReadOnly(readOnly: boolean): void
    forceUpdateDecorations(): void
    on(event: string, listener: (...args: never[]) => void): void
    canUndo(): boolean
    canRedo(): boolean
    undo(): void
    redo(): void
    selectAll(): void
    destroy(): void
    [key: string]: unknown
  }

  export const CodeBlockLanguageSelector: unknown
  export const EmojiSelector: unknown
  export const FootnoteTool: unknown
  export const ImageEditTool: unknown
  export const ImagePathPicker: unknown
  export const ImageResizeBar: unknown
  export const ImageToolBar: unknown
  export const InlineFormatToolbar: unknown
  export const LinkTools: unknown
  export const ParagraphFrontButton: unknown
  export const ParagraphFrontMenu: unknown
  export const ParagraphQuickInsertMenu: unknown
  export const PreviewToolBar: unknown
  export const TableChessboard: unknown
  export const TableColumnToolbar: unknown
  export const TableDragBar: unknown
  export const TableRowColumMenu: unknown

  export class MarkdownToHtml {
    markdown: string
    constructor(markdown: string, muya?: unknown)
    renderHtml(): Promise<string>
    generate(options?: {
      title?: string
      extraCSS?: string
      inlineStyles?: boolean
      dir?: string
    }): Promise<string>
  }

  export function renderToStaticHTML(...args: unknown[]): unknown
  export function escapeHTML(str: string): string
  export function unescapeHTML(str: string): string
  export function sanitize(
    html: string,
    config?: unknown,
    isInline?: boolean
  ): string
  export function generateGithubSlug(text: string): string
  export function getImageInfo(src: string): {
    isUnknownType: boolean
    src: string
    [key: string]: unknown
  }
  export function wordCount(markdown: string): {
    word: number
    paragraph: number
    character: number
    all: number
  }
}

declare module 'plantuml-encoder' {
  const plantumlEncoder: {
    encode: (text: string) => string
    decode: (encoded: string) => string
  }
  export default plantumlEncoder
}
