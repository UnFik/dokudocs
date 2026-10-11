import { expect, it } from 'vitest'
import { platformNavGroup } from './platform-nav'

it('offers the AI provider page only to a superadmin', () => {
  expect(platformNavGroup(['member'])).toBeNull()
  expect(platformNavGroup(['member', 'admin'])).toBeNull()
  expect(platformNavGroup(undefined)).toBeNull()
  expect(platformNavGroup(['member', 'superadmin'])).toMatchObject({
    title: 'Platform',
    items: [{ title: 'AI provider', url: '/platform/ai' }],
  })
})
