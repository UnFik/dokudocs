/**
 * One Mermaid theme for every place a diagram is drawn (Mermaid documents,
 * Markdown previews, thumbnails). Colours come from the app tokens in
 * `styles/theme.css`, with `--signal` as the only accent.
 */

export interface MermaidThemeTokens {
  background: string
  foreground: string
  card: string
  muted: string
  mutedForeground: string
  border: string
  signal: string
  signalForeground: string
}

const TOKEN_VARIABLES: Record<keyof MermaidThemeTokens, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  border: '--border',
  signal: '--signal',
  signalForeground: '--signal-foreground',
}

/**
 * Values of `theme.css`, used when the page cannot be asked (no stylesheet
 * loaded, or a thumbnail drawn for the other mode). `mermaid-theme.test.ts`
 * keeps these equal to the stylesheet.
 */
export const FALLBACK_TOKENS: Record<'light' | 'dark', MermaidThemeTokens> = {
  light: {
    background: '#f4f5f6',
    foreground: '#14171a',
    card: '#ffffff',
    muted: '#ebedf0',
    mutedForeground: '#5b6470',
    border: '#d5d9dd',
    signal: '#0369a1',
    signalForeground: '#ffffff',
  },
  dark: {
    background: '#0f1114',
    foreground: '#e6e8eb',
    card: '#171a1f',
    muted: '#1e2229',
    mutedForeground: '#8b94a0',
    border: '#262b32',
    signal: '#38bdf8',
    signalForeground: '#04141f',
  },
}

export const MERMAID_FONT_FAMILY =
  "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
export const MERMAID_MONO_FONT_FAMILY =
  "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace"

/** The app tokens for the requested mode. */
export function readThemeTokens(isDark: boolean): MermaidThemeTokens {
  const fallback = FALLBACK_TOKENS[isDark ? 'dark' : 'light']
  if (typeof document === 'undefined') return fallback
  const root = document.documentElement
  if (root.classList.contains('dark') !== isDark) return fallback
  const style = getComputedStyle(root)
  const tokens = { ...fallback }
  for (const key of Object.keys(
    TOKEN_VARIABLES
  ) as (keyof MermaidThemeTokens)[]) {
    const value = style.getPropertyValue(TOKEN_VARIABLES[key]).trim()
    if (/^#[0-9a-f]{6}$/i.test(value)) tokens[key] = value
  }
  return tokens
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** `amount` of `b` mixed into `a`, as a hex colour (Mermaid cannot parse `color-mix`). */
export function mixColors(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = channels(a)
  const [br, bg, bb] = channels(b)
  const part = (x: number, y: number) =>
    Math.round(x + (y - x) * amount)
      .toString(16)
      .padStart(2, '0')
  return `#${part(ar, br)}${part(ag, bg)}${part(ab, bb)}`
}

/** Mermaid `themeVariables` built only from the given tokens. */
export function buildMermaidThemeVariables(
  tokens: MermaidThemeTokens,
  isDark: boolean
): Record<string, string | boolean> {
  const {
    background,
    foreground,
    card,
    muted,
    mutedForeground,
    border,
    signal,
  } = tokens
  const accentFill = mixColors(card, signal, isDark ? 0.22 : 0.1)
  // Categorical scales (pie, gantt, quadrant) vary the one accent by strength.
  const amounts = [0.9, 0.7, 0.5, 0.35, 0.8, 0.6, 0.45, 0.25]
  const scale = amounts.map((amount) =>
    mixColors(isDark ? card : background, signal, amount)
  )

  const variables: Record<string, string | boolean> = {
    darkMode: isDark,
    background: 'transparent',
    fontFamily: MERMAID_FONT_FAMILY,
    fontSize: '14px',

    primaryColor: card,
    primaryTextColor: foreground,
    primaryBorderColor: signal,
    secondaryColor: muted,
    secondaryTextColor: foreground,
    secondaryBorderColor: border,
    tertiaryColor: background,
    tertiaryTextColor: foreground,
    tertiaryBorderColor: border,

    mainBkg: card,
    nodeBorder: signal,
    nodeTextColor: foreground,
    lineColor: mutedForeground,
    defaultLinkColor: mutedForeground,
    textColor: foreground,
    titleColor: foreground,
    clusterBkg: muted,
    clusterBorder: border,
    edgeLabelBackground: card,

    actorBkg: card,
    actorBorder: signal,
    actorTextColor: foreground,
    actorLineColor: mutedForeground,
    signalColor: mutedForeground,
    signalTextColor: foreground,
    labelBoxBkgColor: muted,
    labelBoxBorderColor: border,
    labelTextColor: foreground,
    loopTextColor: foreground,
    noteBkgColor: accentFill,
    noteBorderColor: signal,
    noteTextColor: foreground,
    activationBkgColor: accentFill,
    activationBorderColor: signal,
    sequenceNumberColor: tokens.signalForeground,

    // state, class, ER
    labelColor: foreground,
    altBackground: muted,
    attributeBackgroundColorOdd: card,
    attributeBackgroundColorEven: muted,
    classText: foreground,

    // gantt
    gridColor: border,
    taskBkgColor: accentFill,
    taskBorderColor: signal,
    taskTextColor: foreground,
    taskTextLightColor: foreground,
    taskTextDarkColor: foreground,
    taskTextOutsideColor: foreground,
    activeTaskBkgColor: signal,
    activeTaskBorderColor: signal,
    doneTaskBkgColor: muted,
    doneTaskBorderColor: border,
    critBkgColor: mixColors(card, signal, 0.45),
    critBorderColor: signal,
    todayLineColor: signal,
    sectionBkgColor: muted,
    altSectionBkgColor: card,
    sectionBkgColor2: muted,
  }

  scale.forEach((color, i) => {
    variables[`cScale${i}`] = color
    variables[`pie${i + 1}`] = color
    variables[`cScaleLabel${i}`] =
      amounts[i] >= 0.5 ? tokens.signalForeground : foreground
  })
  variables.pieTitleTextColor = foreground
  variables.pieSectionTextColor = tokens.signalForeground
  variables.pieLegendTextColor = foreground
  variables.pieStrokeColor = card
  variables.pieOuterStrokeColor = border

  return variables
}

/** Mermaid configuration for the app theme in the requested mode. */
export function getAppMermaidConfig(isDark: boolean) {
  return {
    startOnLoad: false,
    theme: 'base' as const,
    fontFamily: MERMAID_FONT_FAMILY,
    suppressErrorRendering: true,
    logLevel: 'fatal' as const,
    themeVariables: buildMermaidThemeVariables(readThemeTokens(isDark), isDark),
  }
}

/** Whether the app is currently showing its dark theme. */
export function isAppDark(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark')
  )
}
