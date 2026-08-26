import { WidgetType, EditorView } from '@codemirror/view'

export class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number
  ) {
    super()
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked && this.pos === other.pos
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = this.checked
    input.className =
      'cm-task-checkbox size-3.5 mr-2 rounded border border-primary/60 text-primary focus:ring-1 focus:ring-primary align-middle cursor-pointer transition-colors accent-primary'

    input.addEventListener('click', (e) => {
      e.stopPropagation()
      const newChecked = !this.checked
      const text = view.state.doc.sliceString(this.pos, this.pos + 3)
      if (text === '[ ]' || text === '[x]' || text === '[X]') {
        view.dispatch({
          changes: {
            from: this.pos,
            to: this.pos + 3,
            insert: newChecked ? '[x]' : '[ ]',
          },
        })
      }
    })

    return input
  }

  ignoreEvent(): boolean {
    return false
  }
}

export class HorizontalRuleWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement('hr')
    hr.className = 'cm-hr my-4 border-t border-border w-full select-none'
    return hr
  }

  ignoreEvent(): boolean {
    return true
  }
}

export class TableWidget extends WidgetType {
  constructor(readonly rawTable: string) {
    super()
  }

  eq(other: TableWidget): boolean {
    return this.rawTable === other.rawTable
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'cm-table-wrapper my-4 overflow-x-auto select-none'

    const table = document.createElement('table')
    table.className =
      'cm-rendered-table w-full border-collapse border border-border text-sm rounded-md overflow-hidden'

    const lines = this.rawTable.trim().split('\n').filter((l) => l.trim().length > 0)
    if (lines.length === 0) return wrapper

    const splitCells = (line: string): string[] => {
      let trimmed = line.trim()
      if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
      if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
      return trimmed.split('|').map((c) => c.trim())
    }

    const headerCells = splitCells(lines[0])
    const alignments: Array<'left' | 'center' | 'right'> = []

    if (lines.length > 1 && lines[1].includes('-')) {
      const alignCells = splitCells(lines[1])
      alignCells.forEach((c) => {
        if (c.startsWith(':') && c.endsWith(':')) {
          alignments.push('center')
        } else if (c.endsWith(':')) {
          alignments.push('right')
        } else {
          alignments.push('left')
        }
      })
    }

    const thead = document.createElement('thead')
    const headerRow = document.createElement('tr')
    headerRow.className = 'bg-muted/60 border-b border-border'

    headerCells.forEach((cellText, idx) => {
      const th = document.createElement('th')
      th.className =
        'border border-border px-3.5 py-2 font-semibold text-foreground text-left text-xs uppercase tracking-wider'
      const align = alignments[idx] || 'left'
      th.style.textAlign = align
      th.textContent = cellText
      headerRow.appendChild(th)
    })
    thead.appendChild(headerRow)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    const dataLines = lines.length > 1 && lines[1].includes('-') ? lines.slice(2) : lines.slice(1)

    dataLines.forEach((line) => {
      const row = document.createElement('tr')
      row.className = 'border-b border-border/60 even:bg-muted/20 hover:bg-muted/40 transition-colors'
      const cells = splitCells(line)

      cells.forEach((cellText, idx) => {
        const td = document.createElement('td')
        td.className = 'border border-border/60 px-3.5 py-2 text-foreground text-xs leading-relaxed'
        const align = alignments[idx] || 'left'
        td.style.textAlign = align
        td.textContent = cellText
        row.appendChild(td)
      })
      tbody.appendChild(row)
    })

    table.appendChild(tbody)
    wrapper.appendChild(table)
    return wrapper
  }

  ignoreEvent(): boolean {
    return true
  }
}
