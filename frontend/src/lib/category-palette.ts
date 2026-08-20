export interface CategoryPalette {
  id: string
  name: string
  bg: string
  text: string
  border: string
  activeBg: string
  activeText: string
  badgeBg: string
  badgeText: string
  dot: string
  hex: string
}

export const CATEGORY_COLOR_OPTIONS: CategoryPalette[] = [
  {
    id: 'blue',
    name: 'Blue',
    bg: 'bg-blue-500/10 hover:bg-blue-500/15',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-500/30',
    activeBg: 'bg-blue-600 dark:bg-blue-500',
    activeText: 'text-white',
    badgeBg: 'bg-blue-500/20',
    badgeText: 'text-blue-700 dark:text-blue-300',
    dot: 'bg-blue-500',
    hex: '#3b82f6',
  },
  {
    id: 'emerald',
    name: 'Emerald',
    bg: 'bg-emerald-500/10 hover:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-500/30',
    activeBg: 'bg-emerald-600 dark:bg-emerald-500',
    activeText: 'text-white',
    badgeBg: 'bg-emerald-500/20',
    badgeText: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    hex: '#10b981',
  },
  {
    id: 'purple',
    name: 'Purple',
    bg: 'bg-purple-500/10 hover:bg-purple-500/15',
    text: 'text-purple-700 dark:text-purple-300',
    border: 'border-purple-500/30',
    activeBg: 'bg-purple-600 dark:bg-purple-500',
    activeText: 'text-white',
    badgeBg: 'bg-purple-500/20',
    badgeText: 'text-purple-700 dark:text-purple-300',
    dot: 'bg-purple-500',
    hex: '#8b5cf6',
  },
  {
    id: 'amber',
    name: 'Amber',
    bg: 'bg-amber-500/10 hover:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-500/30',
    activeBg: 'bg-amber-600 dark:bg-amber-500',
    activeText: 'text-white',
    badgeBg: 'bg-amber-500/20',
    badgeText: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
    hex: '#f59e0b',
  },
  {
    id: 'rose',
    name: 'Rose',
    bg: 'bg-rose-500/10 hover:bg-rose-500/15',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-500/30',
    activeBg: 'bg-rose-600 dark:bg-rose-500',
    activeText: 'text-white',
    badgeBg: 'bg-rose-500/20',
    badgeText: 'text-rose-700 dark:text-rose-300',
    dot: 'bg-rose-500',
    hex: '#f43f5e',
  },
  {
    id: 'cyan',
    name: 'Cyan',
    bg: 'bg-cyan-500/10 hover:bg-cyan-500/15',
    text: 'text-cyan-700 dark:text-cyan-300',
    border: 'border-cyan-500/30',
    activeBg: 'bg-cyan-600 dark:bg-cyan-500',
    activeText: 'text-white',
    badgeBg: 'bg-cyan-500/20',
    badgeText: 'text-cyan-700 dark:text-cyan-300',
    dot: 'bg-cyan-500',
    hex: '#06b6d4',
  },
  {
    id: 'indigo',
    name: 'Indigo',
    bg: 'bg-indigo-500/10 hover:bg-indigo-500/15',
    text: 'text-indigo-700 dark:text-indigo-300',
    border: 'border-indigo-500/30',
    activeBg: 'bg-indigo-600 dark:bg-indigo-500',
    activeText: 'text-white',
    badgeBg: 'bg-indigo-500/20',
    badgeText: 'text-indigo-700 dark:text-indigo-300',
    dot: 'bg-indigo-500',
    hex: '#6366f1',
  },
  {
    id: 'teal',
    name: 'Teal',
    bg: 'bg-teal-500/10 hover:bg-teal-500/15',
    text: 'text-teal-700 dark:text-teal-300',
    border: 'border-teal-500/30',
    activeBg: 'bg-teal-600 dark:bg-teal-500',
    activeText: 'text-white',
    badgeBg: 'bg-teal-500/20',
    badgeText: 'text-teal-700 dark:text-teal-300',
    dot: 'bg-teal-500',
    hex: '#14b8a6',
  },
]

export function getCategoryPalette(
  name: string,
  colorId?: string,
  index?: number
): CategoryPalette {
  if (colorId) {
    const matched = CATEGORY_COLOR_OPTIONS.find((c) => c.id === colorId)
    if (matched) return matched
  }

  if (typeof index === 'number' && index >= 0) {
    return CATEGORY_COLOR_OPTIONS[index % CATEGORY_COLOR_OPTIONS.length]
  }

  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }

  const normalizedIndex = Math.abs(hash) % CATEGORY_COLOR_OPTIONS.length
  return CATEGORY_COLOR_OPTIONS[normalizedIndex]
}
