import type { NodeViewConstructor } from 'prosemirror-view'

/**
 * A toggle shows its first block as the title and a button that folds the rest.
 * Whether it is folded is this reader's own choice and is not saved.
 */
export const toggleView: NodeViewConstructor = (node) => {
  const dom = document.createElement('div')
  dom.className = 'dd-toggle'
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'dd-toggle-button'
  button.contentEditable = 'false'
  const body = document.createElement('div')
  body.className = 'dd-toggle-body'
  dom.append(button, body)

  let folded = false
  const render = () => {
    dom.classList.toggle('dd-toggle-folded', folded)
    button.setAttribute('aria-expanded', String(!folded))
    button.setAttribute('aria-label', folded ? 'Unfold' : 'Fold')
  }
  const identity = (current: typeof node) => {
    const nodeID = current.attrs.nodeID as string | null
    if (nodeID) {
      dom.id = `node-${nodeID}`
      dom.dataset.nodeId = nodeID
    }
  }
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', () => {
    folded = !folded
    render()
  })
  identity(node)
  render()
  return {
    dom,
    contentDOM: body,
    update(next) {
      if (next.type !== node.type) return false
      identity(next)
      return true
    },
  }
}
