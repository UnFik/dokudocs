import { describe, expect, it } from 'vitest'
import { panelWidth, panelWidths } from './panel-width'

describe('the width of a side panel', () => {
  it('starts at its default', () => {
    expect(panelWidth('palette', undefined)).toBe(panelWidths.palette.default)
    expect(panelWidth('props', 'wide')).toBe(panelWidths.props.default)
  })

  it('stays between its narrowest and widest', () => {
    expect(panelWidth('palette', 100)).toBe(panelWidths.palette.min)
    expect(panelWidth('palette', 900)).toBe(panelWidths.palette.max)
    expect(panelWidth('props', 300.6)).toBe(301)
  })
})
