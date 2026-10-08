// Lucide glyphs (24px grid, 1.5 stroke) as SVG children, one per block menu
// entry. Inline markup keeps the menu free of a React render. Headings use
// their level as text instead (see blockMenu).
const rect = (attrs: string) => `<rect ${attrs}/>`
const path = (d: string) => `<path d="${d}"/>`

export const blockIcons: Record<string, string> = {
  'bullet-list': [
    'M3 5h.01',
    'M3 12h.01',
    'M3 19h.01',
    'M8 5h13',
    'M8 12h13',
    'M8 19h13',
  ]
    .map(path)
    .join(''),
  'ordered-list': [
    'M11 5h10',
    'M11 12h10',
    'M11 19h10',
    'M4 4h1v5',
    'M4 9h2',
    'M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02',
  ]
    .map(path)
    .join(''),
  'task-list':
    ['M13 5h8', 'M13 12h8', 'M13 19h8', 'm3 17 2 2 4-4'].map(path).join('') +
    rect('x="3" y="4" width="6" height="6" rx="1"'),
  quote: ['M17 5H3', 'M21 12H8', 'M21 19H8', 'M3 12v7'].map(path).join(''),
  'code-block': ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'].map(path).join(''),
  table:
    path('M12 3v18') +
    rect('width="18" height="18" x="3" y="3" rx="2"') +
    path('M3 9h18') +
    path('M3 15h18'),
  divider: path('M5 12h14'),
  'math-block': path(
    'M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2'
  ),
  mermaid:
    rect('width="8" height="8" x="3" y="3" rx="2"') +
    path('M7 11v4a2 2 0 0 0 2 2h4') +
    rect('width="8" height="8" x="13" y="13" rx="2"'),
  'notice-info':
    '<circle cx="12" cy="12" r="10"/>' + path('M12 16v-4') + path('M12 8h.01'),
  'notice-success': '<circle cx="12" cy="12" r="10"/>' + path('m9 12 2 2 4-4'),
  'notice-warning': [
    'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
    'M12 9v4',
    'M12 17h.01',
  ]
    .map(path)
    .join(''),
  'notice-tip': [
    'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5',
    'M9 18h6',
    'M10 22h4',
  ]
    .map(path)
    .join(''),
  toggle:
    '<circle cx="15" cy="12" r="3"/>' +
    rect('width="20" height="14" x="2" y="5" rx="7"'),
  'image-address':
    rect('width="18" height="18" x="3" y="3" rx="2" ry="2"') +
    '<circle cx="9" cy="9" r="2"/>' +
    path('m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'),
  'inline-math':
    rect('width="18" height="18" x="3" y="3" rx="2" ry="2"') +
    path('M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3') +
    path('M9 11.2h5.7'),
  'page-break': ['m16 16-4 4-4-4', 'M3 12h18', 'm8 8 4-4 4 4']
    .map(path)
    .join(''),
  'current-date':
    [
      'M8 2v4',
      'M16 2v4',
      'M3 10h18',
      'M8 14h.01',
      'M12 14h.01',
      'M16 14h.01',
      'M8 18h.01',
      'M12 18h.01',
      'M16 18h.01',
    ]
      .map(path)
      .join('') + rect('width="18" height="18" x="3" y="4" rx="2"'),
}
blockIcons['toggle-heading'] = blockIcons.toggle!
blockIcons['upload-file'] = blockIcons['image-address']!

/** The icon for a menu entry: the level for a heading, a glyph for the rest. */
export function blockIcon(id: string): HTMLElement {
  const holder = document.createElement('span')
  holder.className = 'dd-slash-icon'
  holder.setAttribute('aria-hidden', 'true')
  const level = /^heading-(\d)$/.exec(id)?.[1]
  if (level) {
    holder.textContent = `H${level}`
    holder.classList.add('dd-slash-level')
    return holder
  }
  const svg = blockIcons[id]
  if (svg)
    holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`
  return holder
}
