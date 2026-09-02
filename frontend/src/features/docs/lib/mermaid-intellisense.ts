export interface MermaidSuggestion {
  label: string
  insertText: string
  kind: 'diagram' | 'keyword' | 'participant' | 'arrow' | 'shape' | 'snippet'
  detail: string
  documentation?: string
  cursorOffset?: number
}

export const MERMAID_KEYWORDS: MermaidSuggestion[] = [
  {
    label: 'sequenceDiagram',
    insertText:
      'sequenceDiagram\n    autonumber\n    participant App as Client\n    participant Server as Backend\n    \n    App->>Server: Request\n    Server-->>App: Response\n',
    kind: 'diagram',
    detail: 'Sequence Diagram Template',
    documentation:
      'Declare an interactive sequence diagram with actors and lifelines.',
  },
  {
    label: 'flowchart TD',
    insertText:
      'flowchart TD\n    Start([Start]) --> Process[Process Data]\n    Process --> Decision{Is Valid?}\n    Decision -- Yes --> Success([Success])\n    Decision -- No --> Error([Error])\n',
    kind: 'diagram',
    detail: 'Top-Down Flowchart',
    documentation:
      'Create a top-to-bottom flowchart with shapes and decision nodes.',
  },
  {
    label: 'flowchart LR',
    insertText: 'flowchart LR\n    A[Step 1] --> B[Step 2] --> C[Step 3]\n',
    kind: 'diagram',
    detail: 'Left-to-Right Flowchart',
    documentation: 'Create a left-to-right horizontal flowchart.',
  },
  {
    label: 'classDiagram',
    insertText:
      'classDiagram\n    class User {\n      +String id\n      +String email\n      +login()\n    }\n',
    kind: 'diagram',
    detail: 'UML Class Diagram',
    documentation: 'Model object-oriented class hierarchies and methods.',
  },
  {
    label: 'erDiagram',
    insertText:
      'erDiagram\n    USER ||--o{ ORDER : places\n    ORDER ||--|{ LINE-ITEM : contains\n',
    kind: 'diagram',
    detail: 'Entity Relationship Diagram',
    documentation: 'Declare database entity relationships and cardinalities.',
  },
  {
    label: 'stateDiagram-v2',
    insertText:
      'stateDiagram-v2\n    [*] --> Idle\n    Idle --> Processing: Event\n    Processing --> Success: Done\n    Processing --> Error: Fail\n    Success --> [*]\n    Error --> Idle: Retry\n',
    kind: 'diagram',
    detail: 'State Machine Diagram',
    documentation: 'Model finite state transitions and state machines.',
  },
  {
    label: 'participant',
    insertText: 'participant Name as Label',
    kind: 'keyword',
    detail: 'Define lifeline participant',
    documentation: 'Declare a participant box in a sequence diagram.',
  },
  {
    label: 'actor',
    insertText: 'actor User as End User',
    kind: 'keyword',
    detail: 'Define human actor',
    documentation: 'Render a stick figure actor in sequence diagram.',
  },
  {
    label: 'autonumber',
    insertText: 'autonumber',
    kind: 'keyword',
    detail: 'Auto message numbering',
    documentation: 'Automatically number all sequence diagram message steps.',
  },
  {
    label: 'Note over',
    insertText: 'Note over ParticipantA, ParticipantB: Note description',
    kind: 'keyword',
    detail: 'Note spanning participants',
    documentation:
      'Render an annotation note spanning one or multiple lifelines.',
  },
  {
    label: 'Note right of',
    insertText: 'Note right of Participant: Note description',
    kind: 'keyword',
    detail: 'Note right of participant',
  },
  {
    label: 'Note left of',
    insertText: 'Note left of Participant: Note description',
    kind: 'keyword',
    detail: 'Note left of participant',
  },
  {
    label: 'loop',
    insertText:
      'loop Every 5s\n    A->>B: Poll status\n    B-->>A: Status OK\nend',
    kind: 'keyword',
    detail: 'Loop block container',
    documentation: 'Wrap repeating sequence steps inside a loop frame.',
  },
  {
    label: 'alt / else',
    insertText:
      'alt Success Case\n    A->>B: 200 OK\nelse Error Case\n    A->>B: 400 Bad Request\nend',
    kind: 'keyword',
    detail: 'Alternative condition branches',
  },
  {
    label: 'opt',
    insertText: 'opt If condition\n    A->>B: Action\nend',
    kind: 'keyword',
    detail: 'Optional condition block',
  },
  {
    label: 'par / and',
    insertText:
      'par Parallel Task 1\n    A->>B: Fetch User\nand Parallel Task 2\n    A->>C: Fetch Settings\nend',
    kind: 'keyword',
    detail: 'Parallel execution block',
  },
  {
    label: 'critical / option',
    insertText:
      'critical Action\n    A->>B: Critical transaction\noption Fallback\n    A->>C: Rollback\nend',
    kind: 'keyword',
    detail: 'Critical section with fallback',
  },
  {
    label: 'subgraph',
    insertText:
      'subgraph ClusterName [Group Title]\n    A[Node 1] --> B[Node 2]\nend',
    kind: 'keyword',
    detail: 'Flowchart group container',
  },
  {
    label: '->> (Solid Arrow)',
    insertText: '->> ',
    kind: 'arrow',
    detail: 'Synchronous request arrow',
  },
  {
    label: '-->> (Dotted Arrow)',
    insertText: '-->> ',
    kind: 'arrow',
    detail: 'Response / return arrow',
  },
  {
    label: '-x (Lost message)',
    insertText: '-x ',
    kind: 'arrow',
    detail: 'Solid lost message arrow',
  },
  {
    label: '-) (Async message)',
    insertText: '-) ',
    kind: 'arrow',
    detail: 'Asynchronous message arrow',
  },
  {
    label: '[...] (Rectangle)',
    insertText: '[Node Label]',
    kind: 'shape',
    detail: 'Standard box node',
  },
  {
    label: '([ ... ]) (Rounded Capsule)',
    insertText: '([Start / End])',
    kind: 'shape',
    detail: 'Terminal pill capsule node',
  },
  {
    label: '{ ... } (Diamond / Decision)',
    insertText: '{Decision?}',
    kind: 'shape',
    detail: 'Decision rhombus node',
  },
  {
    label: '[( ... )] (Cylinder Database)',
    insertText: '[(Database SQL)]',
    kind: 'shape',
    detail: 'Database cylinder node',
  },
  {
    label: '(( ... )) (Circle)',
    insertText: '((Circle Node))',
    kind: 'shape',
    detail: 'Circular node',
  },
  {
    label: '{{ ... }} (Hexagon)',
    insertText: '{{Preparation Step}}',
    kind: 'shape',
    detail: 'Hexagon node',
  },
  {
    label: 'classDef',
    insertText:
      'classDef highlight fill:#10b981,stroke:#059669,stroke-width:2px,color:#fff;\n',
    kind: 'keyword',
    detail: 'Custom CSS node styling',
  },
]

export function getMermaidSuggestions(
  currentText: string,
  cursorPosition: number
): { suggestions: MermaidSuggestion[]; matchPrefix: string } {
  const textBeforeCursor = currentText.substring(0, cursorPosition)
  const lastLine = textBeforeCursor.split('\n').pop() || ''
  const trimmedLine = lastLine.trimStart()

  if (trimmedLine.startsWith('%%')) {
    return { suggestions: [], matchPrefix: '' }
  }

  const wordMatch = lastLine.match(/([a-zA-Z0-9_-]+)$/)
  const currentWord = wordMatch ? wordMatch[1] : ''

  const extractedParticipants: string[] = []
  const participantMatches = currentText.matchAll(
    /(?:participant|actor)\s+([a-zA-Z0-9_]+)/g
  )
  for (const m of participantMatches) {
    if (!extractedParticipants.includes(m[1])) {
      extractedParticipants.push(m[1])
    }
  }

  const participantSuggestions: MermaidSuggestion[] = extractedParticipants.map(
    (p) => ({
      label: p,
      insertText: p,
      kind: 'participant',
      detail: 'Declared Participant',
    })
  )

  const allSuggestions = [...participantSuggestions, ...MERMAID_KEYWORDS]

  if (!currentWord) {
    return {
      suggestions: allSuggestions.slice(0, 15),
      matchPrefix: '',
    }
  }

  const filtered = allSuggestions
    .filter((s) => s.label.toLowerCase().includes(currentWord.toLowerCase()))
    .sort((a, b) => {
      const aStarts = a.label
        .toLowerCase()
        .startsWith(currentWord.toLowerCase())
      const bStarts = b.label
        .toLowerCase()
        .startsWith(currentWord.toLowerCase())
      if (aStarts && !bStarts) return -1
      if (!aStarts && bStarts) return 1
      return a.label.localeCompare(b.label)
    })
    .slice(0, 15)

  return {
    suggestions: filtered,
    matchPrefix: currentWord,
  }
}
