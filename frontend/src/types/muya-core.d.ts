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

  export class Muya {
    static use(plugin: any, options?: Record<string, unknown>): void
    constructor(element: HTMLElement, options?: Record<string, unknown>)
    init(): void
    [key: string]: any
  }

  export const CodeBlockLanguageSelector: any
  export const EmojiSelector: any
  export const FootnoteTool: any
  export const ImageEditTool: any
  export const ImagePathPicker: any
  export const ImageResizeBar: any
  export const ImageToolBar: any
  export const InlineFormatToolbar: any
  export const LinkTools: any
  export const ParagraphFrontButton: any
  export const ParagraphFrontMenu: any
  export const ParagraphQuickInsertMenu: any
  export const PreviewToolBar: any
  export const TableChessboard: any
  export const TableColumnToolbar: any
  export const TableDragBar: any
  export const TableRowColumMenu: any

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

  export function renderToStaticHTML(...args: any[]): any
  export function escapeHTML(str: string): string
  export function unescapeHTML(str: string): string
  export function sanitize(html: string, config?: any, isInline?: boolean): string
  export function generateGithubSlug(text: string): string
  export function getImageInfo(src: string): { isUnknownType: boolean; src: string; [key: string]: any }
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
