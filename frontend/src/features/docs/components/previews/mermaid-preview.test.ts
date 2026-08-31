import { describe, expect, it } from 'vitest'
import { getMermaidSuggestions } from '../../lib/mermaid-intellisense'
import { highlightMermaidCode } from '../../lib/mermaid-tokenizer'
import {
  generateDbmlThumbnail,
  generateDualThumbnailsAsync,
  generateMermaidThumbnail,
  generateThumbnailAsync,
} from '../../lib/doc-thumbnail-generator'

describe('Mermaid Tokenizer & Syntax Highlighter', () => {
  it('correctly tokenizes and highlights sequence diagram keywords and arrows', () => {
    const code = `sequenceDiagram
    autonumber
    participant App as Elysia Application
    participant RestClient as TuyaRestClient
    RestClient->>RestClient: Generate SHA256
    RestClient-->>App: Return Decoded Data`

    const html = highlightMermaidCode(code)
    expect(html).toContain('sequenceDiagram')
    expect(html).toContain('autonumber')
    expect(html).toContain('participant')
    expect(html).toContain('-&gt;&gt;')
    expect(html).toContain('--&gt;&gt;')
  })

  it('correctly highlights comments and notes', () => {
    const code = `%% Comment line
Note over App, Tuya: 2. Execute Authenticated API Request`
    const html = highlightMermaidCode(code)
    expect(html).toContain('%% Comment line')
    expect(html).toContain('Note')
    expect(html).toContain('over')
  })
})

describe('Mermaid IntelliSense', () => {
  it('suggests diagram types and keywords', () => {
    const result = getMermaidSuggestions('seq', 3)
    expect(result.suggestions.some((s) => s.label === 'sequenceDiagram')).toBe(true)
  })

  it('extracts declared participants for autocomplete', () => {
    const text = `sequenceDiagram
participant App as Client
participant Tuya as OpenAPI
`
    const result = getMermaidSuggestions(text, text.length)
    expect(result.suggestions.some((s) => s.label === 'App')).toBe(true)
    expect(result.suggestions.some((s) => s.label === 'Tuya')).toBe(true)
  })
})

describe('Mermaid & Flowchart Thumbnail Generator', () => {
  it('generates a structured SVG thumbnail for flowcharts with shapes and directions', () => {
    const flowchartCode = `flowchart TD
    Start([Start Order]) --> Process[Process Payment]
    Process --> Decision{Is Valid?}
    Decision -- Yes --> Success([Success])
    Decision -- No --> Error([Error])`

    const svg = generateMermaidThumbnail(flowchartCode)
    expect(svg).toContain('<svg')
    expect(svg).toContain('Start Order')
    expect(svg).toContain('Process Payment')
    expect(svg).toContain('Is Valid?')
    expect(svg).toContain('mmArrow')
    expect(svg).toContain('Yes')
    expect(svg).toContain('No')
  })

  it('generates light and dark mode variants for flowcharts', () => {
    const flowchartCode = `flowchart TD
    A[Node A] --> B[Node B]`

    const lightSvg = generateMermaidThumbnail(flowchartCode, false)
    const darkSvg = generateMermaidThumbnail(flowchartCode, true)

    expect(lightSvg).toContain('fill="#ffffff"')
    expect(darkSvg).toContain('fill="#09090b"')
    expect(darkSvg).toContain('fill="#18181b"')
  })

  it('samples top hero nodes when flowchart exceeds max nodes', () => {
    let largeFlowchart = 'flowchart TD\n'
    for (let i = 1; i <= 25; i++) {
      largeFlowchart += `Node${i}[Step ${i}] --> Node${i + 1}[Step ${i + 1}]\n`
    }
    const svg = generateMermaidThumbnail(largeFlowchart)
    expect(svg).toContain('<svg')
    expect(svg).toContain('Step 1')
  })

  it('samples top hero tables and caps columns in large DBML schema', () => {
    let largeDbml = ''
    for (let i = 1; i <= 15; i++) {
      largeDbml += `Table table_${i} {\n`
      for (let j = 1; j <= 12; j++) {
        largeDbml += `  col_${j} varchar [${j === 1 ? 'pk' : ''}]\n`
      }
      largeDbml += '}\n'
    }
    largeDbml += 'Ref: table_1.col_1 > table_2.col_1\n'
    largeDbml += 'Ref: table_1.col_1 > table_3.col_1\n'

    const lightSvg = generateDbmlThumbnail(largeDbml, 'doc-1', false)
    const darkSvg = generateDbmlThumbnail(largeDbml, 'doc-1', true)

    expect(lightSvg).toContain('<svg')
    expect(lightSvg).toContain('table_1')
    expect(lightSvg).toContain('+7 more fields')
    expect(lightSvg).toContain('fill="#ffffff"')

    expect(darkSvg).toContain('<svg')
    expect(darkSvg).toContain('fill="#09090b"')
    expect(darkSvg).toContain('fill="#18181b"')
  })

  it('generates a structured SVG thumbnail for sequence diagrams in dark mode', () => {
    const seqCode = `sequenceDiagram
    autonumber
    participant Client
    participant Server
    Client->>Server: GET /data
    Server-->>Client: 200 OK`

    const lightSvg = generateMermaidThumbnail(seqCode, false)
    const darkSvg = generateMermaidThumbnail(seqCode, true)

    expect(lightSvg).toContain('Client')
    expect(lightSvg).toContain('fill="#ffffff"')

    expect(darkSvg).toContain('Client')
    expect(darkSvg).toContain('fill="#09090b"')
  })

  it('generates thumbnail asynchronously via generateThumbnailAsync for dark and light', async () => {
    const code = `flowchart LR
    A[Step 1] --> B[Step 2]`
    const lightThumb = await generateThumbnailAsync('mermaid', code, undefined, false)
    const darkThumb = await generateThumbnailAsync('mermaid', code, undefined, true)

    expect(lightThumb).toBeTruthy()
    expect(darkThumb).toBeTruthy()
  })

  it('generates dual thumbnails simultaneously via generateDualThumbnailsAsync', async () => {
    const code = `flowchart LR
    A[Step 1] --> B[Step 2]`
    const result = await generateDualThumbnailsAsync('mermaid', code)

    expect(result.thumbnail).toBeTruthy()
    expect(result.thumbnailDark).toBeTruthy()
  })
})

describe('Markdown Preview Heading Extraction & Slug IDs', () => {
  function generateSlug(text: string): string {
    return text
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
  }

  it('generates consistent and clean slug IDs for heading strings', () => {
    expect(generateSlug('Heading 1: Getting Started')).toBe('heading-1-getting-started')
    expect(generateSlug('What is Dokudocs? (Overview)')).toBe('what-is-dokudocs-overview')
    expect(generateSlug('   Leading & Trailing Spaces   ')).toBe('leading-trailing-spaces')
    expect(generateSlug('Special @#$% Characters!')).toBe('special-characters')
  })

  it('extracts H1 to H4 headings while ignoring code blocks', () => {
    const markdown = `# Title
Some introduction text.

## Section 1: Setup
Description for setup.

\`\`\`markdown
# This is inside a code block
## Also in code block
\`\`\`

### Step 1.1: Installation
Run the command.

#### Detail 1.1.1: Configuration
More details.

##### H5 Ignored
###### H6 Ignored
`

    const lines = markdown.split('\n')
    const headings: Array<{ id: string; text: string; level: number }> = []
    let inCodeBlock = false

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock
        continue
      }
      if (inCodeBlock) continue

      const match = trimmed.match(/^(#{1,4})\s+(.+)$/)
      if (match) {
        const level = match[1].length
        const rawText = match[2].trim()
        const cleanText = rawText.replace(/\*\*/g, '').replace(/[*_`]/g, '')
        const slug = generateSlug(cleanText)
        headings.push({
          id: `heading-${slug}`,
          text: cleanText,
          level,
        })
      }
    }

    expect(headings).toHaveLength(4)
    expect(headings[0]).toEqual({
      id: 'heading-title',
      text: 'Title',
      level: 1,
    })
    expect(headings[1]).toEqual({
      id: 'heading-section-1-setup',
      text: 'Section 1: Setup',
      level: 2,
    })
    expect(headings[2]).toEqual({
      id: 'heading-step-11-installation',
      text: 'Step 1.1: Installation',
      level: 3,
    })
    expect(headings[3]).toEqual({
      id: 'heading-detail-111-configuration',
      text: 'Detail 1.1.1: Configuration',
      level: 4,
    })
  })
})

describe('Mermaid Syntax Validation & Error Handling', () => {
  it('detects syntax errors in invalid Mermaid code', async () => {
    const mermaid = (await import('mermaid')).default
    const invalidCode = `sequenceDiagram
    autonumber
    Note over App, `

    let caughtError: any = null
    try {
      await mermaid.parse(invalidCode)
    } catch (err) {
      caughtError = err
    }

    expect(caughtError).not.toBeNull()
    const errorMsg = caughtError?.message || String(caughtError)
    expect(errorMsg).toContain('Parse error')
  })

  it('validates correct Mermaid sequence and flowchart code', async () => {
    const mermaid = (await import('mermaid')).default
    const validSeq = `sequenceDiagram
    participant A
    participant B
    A->>B: Message`

    const validFlow = `flowchart TD
    A[Start] --> B[End]`

    const parsedSeq = await mermaid.parse(validSeq)
    const parsedFlow = await mermaid.parse(validFlow)

    expect(parsedSeq).toBeTruthy()
    expect(parsedFlow).toBeTruthy()
  })

  it('safely generates thumbnails for invalid Mermaid input without crashing', () => {
    const invalidCode = `sequenceDiagram
    invalid gibberish ::: >>>`

    const thumbnail = generateMermaidThumbnail(invalidCode, false)
    expect(typeof thumbnail).toBe('string')
  })
})

