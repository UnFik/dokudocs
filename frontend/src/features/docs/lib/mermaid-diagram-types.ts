/**
 * Diagram types that Mermaid draws but older Dokudocs menus did not list.
 * One entry feeds the template picker, the editor suggestions, and the
 * syntax highlighting. All of them are beta in the installed Mermaid
 * (see docs/plans/diagram-types.md), so their syntax can change between
 * minor versions.
 */
export interface MermaidDiagramType {
  /** The word that starts the source. */
  keyword: string
  name: string
  description: string
  category: string
  template: string
}

export const MERMAID_DIAGRAM_TYPES: MermaidDiagramType[] = [
  {
    keyword: 'radar-beta',
    name: 'Team Skills Radar',
    description: 'Compare several things across the same axes',
    category: 'Radar (beta)',
    template: `radar-beta
    title Team skills
    axis fe["Frontend"], be["Backend"], ops["Ops"], design["Design"], test["Testing"]
    curve a["Team A"]{4, 3, 2, 3, 4}
    curve b["Team B"]{2, 4, 4, 1, 3}
    max 5
`,
  },
  {
    keyword: 'treemap-beta',
    name: 'Budget Treemap',
    description: 'Show how a total splits into nested parts',
    category: 'Treemap (beta)',
    template: `treemap-beta
"Budget"
    "Product"
        "Engineering": 60
        "Design": 20
    "Growth"
        "Marketing": 30
        "Sales": 25
    "Operations": 15
`,
  },
  {
    keyword: 'venn-beta',
    name: 'Overlapping Sets',
    description: 'Sets and what they have in common',
    category: 'Venn (beta)',
    template: `venn-beta
    set Frontend["Frontend"]
    set Backend["Backend"]
    union Frontend,Backend["Full stack"]
`,
  },
  {
    keyword: 'wardley-beta',
    name: 'Wardley Map',
    description: 'Components placed by visibility and evolution',
    category: 'Wardley (beta)',
    template: `wardley-beta
title Tea shop
anchor Business [0.95, 0.63]
anchor Public [0.95, 0.78]
component Cup of Tea [0.79, 0.61]
component Tea [0.63, 0.81]
component Kettle [0.43, 0.35]
Business -> Cup of Tea
Public -> Cup of Tea
Cup of Tea -> Tea
Cup of Tea -> Kettle
`,
  },
  {
    keyword: 'ishikawa-beta',
    name: 'Cause and Effect (Fishbone)',
    description: 'Causes grouped under the problem they lead to',
    category: 'Fishbone (beta)',
    template: `ishikawa-beta
    Late delivery
        People
            Training
            Handoffs
        Process
            Unclear scope
            Manual steps
        Tools
            Slow builds
`,
  },
  {
    keyword: 'swimlane-beta',
    name: 'Swimlane Process',
    description: 'Steps of a process grouped by who does them',
    category: 'Swimlane (beta)',
    template: `swimlane-beta
    subgraph Customer
        order[Place order]
        receive[Receive goods]
    end
    subgraph Shop
        pack[Pack order]
        ship[Ship]
    end
    order --> pack
    pack --> ship
    ship --> receive
`,
  },
]
