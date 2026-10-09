/** Indents table bodies by two spaces and keeps the rest of each line as written. */
export function formatDbml(source: string) {
  return source
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (
        trimmed.startsWith('Table ') ||
        trimmed.startsWith('Enum ') ||
        trimmed.startsWith('TableGroup ') ||
        trimmed.startsWith('Project ')
      ) {
        return trimmed
      }
      if (trimmed === '}') {
        return '}'
      }
      if (trimmed && !trimmed.startsWith('//')) {
        return '  ' + trimmed
      }
      return trimmed
    })
    .join('\n')
}
