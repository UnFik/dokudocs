import JSZip from 'jszip'

export type DocxParagraph = {
  style: string | null
  text: string
  boldText: string
  italicText: string
  strikeText: string
  monospaceText: string
  shading: string | null
  /** The list the paragraph belongs to: which one, how deep, and how it counts. */
  list: { id: string; level: number; format: string } | null
  /** Which sides of the paragraph have a border. */
  borders: string[]
  pageBreak: boolean
  element: Element
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const own = (element: Element, name: string) => [
  ...element.getElementsByTagNameNS(W, name),
]

/** What a `.docx` holds, read the way a test can ask about it. */
export async function readDocx(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  const read = async (path: string) =>
    (await zip.file(path)?.async('string')) ?? ''
  const document = new DOMParser().parseFromString(
    await read('word/document.xml'),
    'application/xml'
  )
  const rels = new DOMParser().parseFromString(
    await read('word/_rels/document.xml.rels'),
    'application/xml'
  )
  const numbering = new DOMParser().parseFromString(
    await read('word/numbering.xml'),
    'application/xml'
  )
  const abstractFormat = new Map<string, string>()
  for (const abstract of numbering.getElementsByTagNameNS(W, 'abstractNum'))
    abstractFormat.set(
      abstract.getAttributeNS(W, 'abstractNumId')!,
      abstract
        .getElementsByTagNameNS(W, 'numFmt')[0]
        ?.getAttributeNS(W, 'val') ?? ''
    )
  const formatOfList = new Map<string, string>()
  for (const num of numbering.getElementsByTagNameNS(W, 'num'))
    formatOfList.set(
      num.getAttributeNS(W, 'numId')!,
      abstractFormat.get(
        num
          .getElementsByTagNameNS(W, 'abstractNumId')[0]
          ?.getAttributeNS(W, 'val') ?? ''
      ) ?? ''
    )
  const textOf = (runs: Element[]) =>
    runs
      .map((run) =>
        own(run, 't')
          .map((t) => t.textContent)
          .join('')
      )
      .join('')
  const paragraphs: DocxParagraph[] = [
    ...document.getElementsByTagNameNS(W, 'p'),
  ].map((element) => {
    const runs = own(element, 'r')
    const has = (run: Element, tag: string) => own(run, tag).length > 0
    return {
      style: own(element, 'pStyle')[0]?.getAttributeNS(W, 'val') ?? null,
      text: textOf(runs),
      boldText: textOf(runs.filter((run) => has(run, 'b'))),
      italicText: textOf(runs.filter((run) => has(run, 'i'))),
      strikeText: textOf(runs.filter((run) => has(run, 'strike'))),
      monospaceText: textOf(
        runs.filter((run) =>
          own(run, 'rFonts').some((font) =>
            /mono|consol|courier/i.test(font.getAttributeNS(W, 'ascii') ?? '')
          )
        )
      ),
      shading: own(element, 'shd')[0]?.getAttributeNS(W, 'fill') ?? null,
      list: own(element, 'numPr')[0]
        ? {
            id: own(element, 'numId')[0]!.getAttributeNS(W, 'val')!,
            level: Number(
              own(element, 'ilvl')[0]?.getAttributeNS(W, 'val') ?? 0
            ),
            format:
              formatOfList.get(
                own(element, 'numId')[0]!.getAttributeNS(W, 'val')!
              ) ?? '',
          }
        : null,
      borders: [...(own(element, 'pBdr')[0]?.children ?? [])].map(
        (side) => side.localName
      ),
      pageBreak: own(element, 'br').some(
        (br) => br.getAttributeNS(W, 'type') === 'page'
      ),
      element,
    }
  })
  return {
    paragraphs,
    /** The whole text of the document, paragraphs joined by a newline. */
    text: paragraphs.map((paragraph) => paragraph.text).join('\n'),
    links: [...rels.getElementsByTagName('Relationship')]
      .filter((rel) => /hyperlink$/.test(rel.getAttribute('Type') ?? ''))
      .map((rel) => rel.getAttribute('Target')!),
    /** Each table as rows of cells, each cell the text of its paragraphs. */
    tables: [...document.getElementsByTagNameNS(W, 'tbl')].map((table) =>
      [...table.getElementsByTagNameNS(W, 'tr')].map((row) =>
        [...row.getElementsByTagNameNS(W, 'tc')].map((cell) =>
          [...cell.getElementsByTagNameNS(W, 'p')]
            .map((p) => textOf(own(p, 'r')))
            .join('\n')
        )
      )
    ),
    media: Object.keys(zip.files).filter(
      (name) => name.startsWith('word/media/') && !name.endsWith('/')
    ),
    document,
  }
}
