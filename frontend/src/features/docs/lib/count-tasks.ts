/** How many task items (`- [ ]`, `- [x]`) a Markdown text has, and how many are done. Code blocks do not count. */
export function countTasks(markdown: string) {
  let done = 0
  let total = 0
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^\s*(?:[-*+]|\d{1,9}[.)])\s+\[([ xX])\]\s/.exec(line)
    if (!match) continue
    total++
    if (match[1] !== ' ') done++
  }
  return { done, total }
}
