const pageBreak = /^<div class="page-break"><\/div>\s*$/

/** The slides of a page: split at page breaks, or at `#` and `##` headings when there are none. */
export function slidesOf(markdown: string): string[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const explicit = lines.some((line) => pageBreak.test(line))
  const slides: string[][] = [[]]
  let fenced = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (explicit && !fenced && pageBreak.test(line)) {
      slides.push([])
      continue
    }
    if (!explicit && !fenced && /^#{1,2}\s/.test(line) && slides.at(-1)!.some((l) => l.trim()))
      slides.push([])
    slides.at(-1)!.push(line)
  }
  return slides.map((slide) => slide.join('\n').trim())
}
