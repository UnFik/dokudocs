import { DocumentItem } from '@/types/dokudocs'

export function getDocCategories(doc?: Partial<DocumentItem> | null): string[] {
  if (!doc) return []
  if (Array.isArray(doc.categories) && doc.categories.length > 0) {
    return doc.categories.filter(Boolean)
  }
  if (doc.category && typeof doc.category === 'string') {
    return [doc.category.trim()].filter(Boolean)
  }
  return []
}
