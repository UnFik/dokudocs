import { describe, expect, it } from 'vitest'
import css from '../../../styles/theme.css?raw'
import {
  buildMermaidThemeVariables,
  FALLBACK_TOKENS,
  mixColors,
  readThemeTokens,
  type MermaidThemeTokens,
} from './mermaid-theme'

function block(selector: string) {
  const start = css.indexOf(`${selector} {`)
  return css.slice(start, css.indexOf('}', start))
}

const cssName: Record<keyof MermaidThemeTokens, string> = {
  background: 'background',
  foreground: 'foreground',
  card: 'card',
  muted: 'muted',
  mutedForeground: 'muted-foreground',
  border: 'border',
  signal: 'signal',
  signalForeground: 'signal-foreground',
}

describe('mermaid theme tokens', () => {
  it.each([
    ['light', ':root'],
    ['dark', '.dark'],
  ] as const)('fallback %s tokens equal theme.css', (mode, selector) => {
    const text = block(selector)
    for (const [key, name] of Object.entries(cssName)) {
      const match = text.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))
      expect(match?.[1], `${mode} --${name}`).toBe(
        FALLBACK_TOKENS[mode][key as keyof MermaidThemeTokens]
      )
    }
  })

  it('reads the fallback palette for the requested mode when the page is not themed', () => {
    expect(readThemeTokens(true)).toEqual(FALLBACK_TOKENS.dark)
    expect(readThemeTokens(false)).toEqual(FALLBACK_TOKENS.light)
  })
})

describe('buildMermaidThemeVariables', () => {
  it.each([true, false])('maps tokens to variables (dark=%s)', (isDark) => {
    const tokens = FALLBACK_TOKENS[isDark ? 'dark' : 'light']
    const vars = buildMermaidThemeVariables(tokens, isDark)
    expect(vars.darkMode).toBe(isDark)
    expect(vars.primaryColor).toBe(tokens.card)
    expect(vars.primaryTextColor).toBe(tokens.foreground)
    expect(vars.primaryBorderColor).toBe(tokens.signal)
    expect(vars.lineColor).toBe(tokens.mutedForeground)
    expect(vars.clusterBorder).toBe(tokens.border)
  })

  it('uses only valid hex colours derived from the tokens', () => {
    const vars = buildMermaidThemeVariables(FALLBACK_TOKENS.dark, true)
    for (const [key, value] of Object.entries(vars)) {
      if (typeof value !== 'string') continue
      if (['fontFamily', 'fontSize', 'background'].includes(key)) continue
      expect(value, key).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})

describe('mixColors', () => {
  it('blends two hex colours', () => {
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixColors('#102030', '#102030', 0.7)).toBe('#102030')
  })
})
