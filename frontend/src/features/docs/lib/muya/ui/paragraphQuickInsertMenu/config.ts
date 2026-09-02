import { isOsx } from '../../config'
import { isKeyboardEvent } from '../../utils'
import { lucideIcons } from '../../utils/icons'

const COMMAND_KEY = isOsx ? '⌘' : 'Ctrl'
const OPTION_KEY = isOsx ? '⌥' : 'Alt'
const SHIFT_KEY = isOsx ? '⇧' : 'Shift'

export interface IQuickInsertMenuItem {
  name: string
  children: {
    title: string
    subTitle: string
    label: string
    icon: string
    score?: number
    i18nTitle?: string
    shortCut?: string
    shortKeyMap?: {
      altKey: boolean
      shiftKey: boolean
      metaKey: boolean
      code: string
    }
  }[]
}

export const MENU_CONFIG: IQuickInsertMenuItem[] = [
  {
    name: 'basic blocks',
    children: [
      {
        title: 'Paragraph',
        subTitle: 'Lorem Ipsum text',
        label: 'paragraph',
        shortCut: `${COMMAND_KEY}+0`,
        shortKeyMap: {
          altKey: false,
          shiftKey: false,
          metaKey: true,
          code: 'Digit0',
        },
        icon: lucideIcons.paragraph,
      },
      {
        title: 'Horizontal Line',
        subTitle: '---',
        label: 'thematic-break',
        shortCut: `${OPTION_KEY}+${COMMAND_KEY}+-`,
        shortKeyMap: {
          altKey: true,
          shiftKey: false,
          metaKey: true,
          code: 'Minus',
        },
        icon: lucideIcons.hr,
      },
      {
        title: 'Front Matter',
        subTitle: '--- Lorem Ipsum ---',
        label: 'frontmatter',
        shortCut: `${OPTION_KEY}+${COMMAND_KEY}+Y`,
        shortKeyMap: {
          altKey: true,
          shiftKey: false,
          metaKey: true,
          code: 'KeyY',
        },
        icon: lucideIcons.frontMatter,
      },
    ],
  },
  {
    name: 'headings',
    children: [
      {
        title: 'Heading 1',
        subTitle: '# Lorem Ipsum...',
        label: 'atx-heading 1',
        shortCut: `${COMMAND_KEY}+1`,
        shortKeyMap: {
          altKey: false,
          shiftKey: false,
          metaKey: true,
          code: 'Digit1',
        },
        icon: lucideIcons.heading1,
      },
      {
        title: 'Heading 2',
        subTitle: '## Lorem Ipsum...',
        label: 'atx-heading 2',
        shortCut: `${COMMAND_KEY}+2`,
        shortKeyMap: {
          altKey: false,
          shiftKey: false,
          metaKey: true,
          code: 'Digit2',
        },
        icon: lucideIcons.heading2,
      },
      {
        title: 'Heading 3',
        subTitle: '### Lorem Ipsum...',
        label: 'atx-heading 3',
        shortCut: `${COMMAND_KEY}+3`,
        shortKeyMap: {
          altKey: false,
          shiftKey: false,
          metaKey: true,
          code: 'Digit3',
        },
        icon: lucideIcons.heading3,
      },
      {
        title: 'Heading 4',
        subTitle: '#### Lorem Ipsum...',
        label: 'atx-heading 4',
        shortCut: `${COMMAND_KEY}+4`,
        shortKeyMap: {
          altKey: false,
          shiftKey: false,
          metaKey: true,
          code: 'Digit4',
        },
        icon: lucideIcons.heading4,
      },
      {
        title: 'Heading 5',
        subTitle: '##### Lorem Ipsum...',
        label: 'atx-heading 5',
        shortCut: `${COMMAND_KEY}+5`,
        shortKeyMap: {
          altKey: false,
          shiftKey: false,
          metaKey: true,
          code: 'Digit5',
        },
        icon: lucideIcons.heading5,
      },
      {
        title: 'Heading 6',
        subTitle: '###### Lorem Ipsum...',
        label: 'atx-heading 6',
        shortCut: `${COMMAND_KEY}+6`,
        shortKeyMap: {
          altKey: false,
          shiftKey: false,
          metaKey: true,
          code: 'Digit6',
        },
        icon: lucideIcons.heading6,
      },
    ],
  },
  {
    name: 'advanced blocks',
    children: [
      {
        title: 'Table Block',
        subTitle: '|Lorem | Ipsum |',
        label: 'table',
        shortCut: `${SHIFT_KEY}+${COMMAND_KEY}+T`,
        shortKeyMap: {
          altKey: false,
          shiftKey: true,
          metaKey: true,
          code: 'KeyT',
        },
        icon: lucideIcons.table,
      },
      {
        title: 'Display Math',
        subTitle: '$$ Lorem Ipsum $$',
        label: 'math-block',
        shortCut: `${OPTION_KEY}+${COMMAND_KEY}+M`,
        shortKeyMap: {
          altKey: true,
          shiftKey: false,
          metaKey: true,
          code: 'KeyM',
        },
        icon: lucideIcons.math,
      },
      {
        title: 'HTML Block',
        subTitle: '<div> Lorem Ipsum </div>',
        label: 'html-block',
        shortCut: `${OPTION_KEY}+${COMMAND_KEY}+J`,
        shortKeyMap: {
          altKey: true,
          shiftKey: false,
          metaKey: true,
          code: 'KeyJ',
        },
        icon: lucideIcons.html,
      },
      {
        title: 'Code Block',
        subTitle: '```java Lorem Ipsum ```',
        label: 'code-block',
        shortCut: `${OPTION_KEY}+${COMMAND_KEY}+C`,
        shortKeyMap: {
          altKey: true,
          shiftKey: false,
          metaKey: true,
          code: 'KeyC',
        },
        icon: lucideIcons.code,
      },
      {
        title: 'Quote Block',
        subTitle: '>Lorem Ipsum ...',
        label: 'block-quote',
        shortCut: `${OPTION_KEY}+${COMMAND_KEY}+Q`,
        shortKeyMap: {
          altKey: true,
          shiftKey: false,
          metaKey: true,
          code: 'KeyQ',
        },
        icon: lucideIcons.quote,
      },
    ],
  },
  {
    name: 'list blocks',
    children: [
      {
        title: 'Order List',
        subTitle: '1. Lorem Ipsum ...',
        label: 'order-list',
        shortCut: `${OPTION_KEY}+${COMMAND_KEY}+O`,
        shortKeyMap: {
          altKey: true,
          shiftKey: false,
          metaKey: true,
          code: 'KeyO',
        },
        icon: lucideIcons.orderList,
      },
      {
        title: 'Bullet List',
        subTitle: '- Lorem Ipsum ...',
        label: 'bullet-list',
        shortCut: `${OPTION_KEY}+${COMMAND_KEY}+U`,
        shortKeyMap: {
          altKey: true,
          shiftKey: false,
          metaKey: true,
          code: 'KeyU',
        },
        icon: lucideIcons.bulletList,
      },
      {
        title: 'To-do List',
        subTitle: '- [x] Lorem Ipsum ...',
        label: 'task-list',
        shortCut: `${OPTION_KEY}+${COMMAND_KEY}+X`,
        shortKeyMap: {
          altKey: true,
          shiftKey: false,
          metaKey: true,
          code: 'KeyX',
        },
        icon: lucideIcons.taskList,
      },
    ],
  },
  {
    name: 'diagrams',
    children: [
      {
        title: 'Vega Chart',
        subTitle: 'By vega-lite.js',
        label: 'diagram vega-lite',
        icon: lucideIcons.chart,
      },
      {
        title: 'Mermaid',
        subTitle: 'By mermaid',
        label: 'diagram mermaid',
        icon: lucideIcons.mermaid,
      },
      {
        title: 'Plantuml',
        subTitle: 'By plantuml',
        label: 'diagram plantuml',
        icon: lucideIcons.plantuml,
      },
      {
        title: 'Flowchart',
        subTitle: 'By flowchart.js',
        label: 'diagram flowchart',
        icon: lucideIcons.flowchart,
      },
      {
        title: 'Sequence',
        subTitle: 'By js-sequence-diagrams',
        label: 'diagram sequence',
        icon: lucideIcons.sequence,
      },
    ],
  },
]

export function getLabelFromEvent(event: Event) {
  if (!isKeyboardEvent(event)) return null
  const ALL_MENU_CONFIG = MENU_CONFIG.reduce(
    (acc, section) => [...acc, ...section.children],
    [] as IQuickInsertMenuItem['children']
  )

  const result = ALL_MENU_CONFIG.find((menu) => {
    const { code, metaKey, shiftKey, altKey } = event
    const {
      shortKeyMap = {} as IQuickInsertMenuItem['children'][number]['shortKeyMap'],
    } = menu

    return (
      code === shortKeyMap?.code &&
      metaKey === shortKeyMap.metaKey &&
      shiftKey === shortKeyMap.shiftKey &&
      altKey === shortKeyMap.altKey
    )
  })

  if (result) return result.label
}
