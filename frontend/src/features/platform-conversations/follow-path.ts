import { type Graph, type Step } from './api'

/** How often each node was visited, and which edges the request took from one node to the next. */
export function followPath(graph: Graph, steps: Step[]) {
  const visits = new Map<string, number>()
  const taken = new Set<string>()
  const known = new Set(graph.edges.map((e) => `${e.from}>${e.to}`))
  steps.forEach((step, i) => {
    visits.set(step.node, (visits.get(step.node) ?? 0) + 1)
    const next = steps[i + 1]
    if (next && known.has(`${step.node}>${next.node}`))
      taken.add(`${step.node}>${next.node}`)
  })
  return { visits, taken }
}
