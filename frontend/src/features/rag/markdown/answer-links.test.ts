import { describe, expect, it } from 'vitest'
import { classifyHref } from './answer-links'

const id = '3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f'

describe('classifyHref', () => {
  it('opens http, https and mailto links outside the app', () => {
    expect(classifyHref('https://example.com/a?b=1')).toEqual({
      kind: 'external',
      href: 'https://example.com/a?b=1',
    })
    expect(classifyHref('http://example.com')).toMatchObject({
      kind: 'external',
    })
    expect(classifyHref('mailto:team@example.com')).toMatchObject({
      kind: 'external',
    })
  })

  it('reads doc: links with a real id as a document', () => {
    expect(classifyHref(`doc:${id}`)).toEqual({ kind: 'document', id })
    expect(classifyHref(`DOC:${id.toUpperCase()}`)).toEqual({
      kind: 'document',
      id,
    })
  })

  it('reads an in-app document path as a document', () => {
    expect(classifyHref(`/docs/${id}?workspaceId=abc`)).toEqual({
      kind: 'document',
      id,
    })
  })

  it('drops anything else, so it shows as plain text', () => {
    for (const href of [
      'javascript:alert(1)',
      ' JaVaScRiPt:alert(1)',
      'data:text/html;base64,AAAA',
      'vbscript:x',
      'file:///etc/passwd',
      'doc:not-a-uuid',
      `doc:${id}/extra`,
      '//evil.example/x',
      '/settings',
      '#section',
      'ftp://example.com',
      '',
    ])
      expect(classifyHref(href), href).toEqual({ kind: 'none' })
  })
})
