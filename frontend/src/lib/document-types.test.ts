import { describe, expect, it } from 'vitest'
import {
  creatableDocumentTypeSchema,
  DOCUMENT_TYPES,
  documentTypeSchema,
  getDocumentType,
} from './document-types'

describe('html documents', () => {
  it('are a document type that no menu offers for making one', () => {
    expect(documentTypeSchema.safeParse('html').success).toBe(true)
    expect(creatableDocumentTypeSchema.safeParse('html').success).toBe(false)
    expect(DOCUMENT_TYPES.map(({ value }) => value)).not.toContain('html')
  })

  it('still get their own label and icon in lists', () => {
    expect(getDocumentType('html').label).toBe('HTML')
    expect(getDocumentType('html').icon).toBeDefined()
  })
})
