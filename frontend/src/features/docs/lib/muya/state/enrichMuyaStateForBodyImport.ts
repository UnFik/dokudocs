import { beginRules } from '../inlineRenderer/rules'
import type { Labels } from '../inlineRenderer/types'
import { markdownToInlineNodes, type InlineNode } from './markdownToInlineNodes'
import type { TState } from './types'

export interface MuyaBodyImportState {
  name: string
  meta?: object
  text?: string
  children?: MuyaBodyImportState[]
  inline?: InlineNode[]
  sourceGap?: string
  sourceMarkdown?: string
}

export function enrichMuyaStateForBodyImport(
  states: TState[]
): MuyaBodyImportState[] {
  return enrichStates(states, collectReferenceLabels(states))
}

function enrichStates(states: TState[], labels: Labels): MuyaBodyImportState[] {
  return states.map((state) => {
    const referenceDefinition =
      state.name === 'paragraph' &&
      beginRules.reference_definition.exec(state.text)
    const result: MuyaBodyImportState = {
      name: referenceDefinition ? 'link-reference-definition' : state.name,
    }
    if (state.sourceGap !== undefined) result.sourceGap = state.sourceGap
    if (state.name === 'table' && state.sourceMarkdown)
      result.sourceMarkdown = state.sourceMarkdown
    if ('meta' in state) result.meta = state.meta
    if ('text' in state) result.text = state.text
    if ('children' in state)
      result.children = enrichStates(state.children, labels)
    if (!referenceDefinition && isInlineParent(state.name) && 'text' in state)
      result.inline = markdownToInlineNodes(state.text, {
        hasBeginRules: state.name === 'atx-heading',
        labels,
      })
    return result
  })
}

function collectReferenceLabels(states: TState[]): Labels {
  const labels: Labels = new Map()
  for (const state of states) {
    if (state.name === 'paragraph') {
      const definition = beginRules.reference_definition.exec(state.text)
      if (definition) {
        const label = (definition[2] + definition[3]).toLowerCase()
        if (!labels.has(label))
          labels.set(label, {
            href: definition[6],
            title: definition[10] || '',
          })
      }
    } else if ('children' in state) {
      for (const [label, value] of collectReferenceLabels(state.children))
        if (!labels.has(label)) labels.set(label, value)
    }
  }
  return labels
}

function isInlineParent(name: string): boolean {
  return (
    name === 'paragraph' ||
    name === 'atx-heading' ||
    name === 'setext-heading' ||
    name === 'table.cell'
  )
}
