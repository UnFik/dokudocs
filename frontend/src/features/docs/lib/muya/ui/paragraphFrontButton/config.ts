import type Parent from '../../block/base/parent'
import type AtxHeading from '../../block/commonMark/atxHeading'
import type SetextHeading from '../../block/commonMark/setextHeading'
import type DiagramBlock from '../../block/extra/diagram'
import { lucideIcons } from '../../utils/icons'

const HEADING_ICONS = [
  lucideIcons.heading1,
  lucideIcons.heading2,
  lucideIcons.heading3,
  lucideIcons.heading4,
  lucideIcons.heading5,
  lucideIcons.heading6,
]

const DIAGRAM_ICONS: Record<string, string> = {
  plantuml: lucideIcons.plantuml,
  mermaid: lucideIcons.mermaid,
  'vega-lite': lucideIcons.chart,
  flowchart: lucideIcons.flowchart,
  sequence: lucideIcons.sequence,
}

export function getIcon(block: Parent) {
  const { blockName } = block
  switch (blockName) {
    case 'frontmatter':
      return lucideIcons.frontMatter

    case 'paragraph':
      return lucideIcons.paragraph

    case 'block-quote':
      return lucideIcons.quote

    case 'bullet-list':
      return lucideIcons.bulletList

    case 'order-list':
      return lucideIcons.orderList

    case 'task-list':
      return lucideIcons.taskList

    case 'code-block':
      return lucideIcons.code

    case 'atx-heading':
      return (
        HEADING_ICONS[(block as AtxHeading).meta.level - 1] ||
        lucideIcons.heading1
      )

    case 'setext-heading':
      return (
        HEADING_ICONS[(block as SetextHeading).meta.level - 1] ||
        lucideIcons.heading1
      )

    case 'thematic-break':
      return lucideIcons.hr

    case 'table':
      return lucideIcons.table

    case 'html-block':
      return lucideIcons.html

    case 'math-block':
      return lucideIcons.math

    case 'diagram':
      return (
        DIAGRAM_ICONS[(block as DiagramBlock).meta.type] || lucideIcons.diagram
      )

    case 'footnote':
      return lucideIcons.footnote

    default:
      return lucideIcons.paragraph
  }
}
