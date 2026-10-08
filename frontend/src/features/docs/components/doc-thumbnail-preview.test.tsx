import '@/styles/index.css'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { DocThumbnailPreview } from './doc-thumbnail-preview'

const drawing =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" preserveAspectRatio="xMidYMid meet"><g data-kind="system" fill="var(--card)" stroke="var(--input)"><rect x="10" y="10" width="132" height="50" rx="6" vector-effect="non-scaling-stroke"/></g></svg>'
const hostile =
  '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwned = true"><script>window.__pwned = true</script><rect width="10" height="10"/></svg>'

async function card(props: Parameters<typeof DocThumbnailPreview>[0]) {
  await render(
    <div style={{ width: 280, height: 128 }} data-testid='card'>
      <DocThumbnailPreview {...props} className='h-full w-full' />
    </div>
  )
  return page.getByTestId('card')
}

describe('the card of an Architecture document', () => {
  it('shows the drawing of its canvas, in the theme colours', async () => {
    const box = await card({
      docId: 'a1',
      type: 'architecture',
      content: 'System "API".',
      thumbnail: drawing,
    })
    await expect.element(box.getByText('1 element')).toBeVisible()
    const rect = box.element().querySelector('svg g[data-kind="system"] rect')
    expect(rect).not.toBeNull()
    expect(rect!.closest('g')!.getAttribute('fill')).toBe('var(--card)')
    // Lines keep their width on screen when the drawing is shrunk.
    expect(rect!.getAttribute('vector-effect')).toBe('non-scaling-stroke')
  })

  it('shows an empty Host frame while it has no drawing', async () => {
    const box = await card({ docId: 'a2', type: 'architecture', content: '' })
    await expect.element(box.getByText('Empty canvas')).toBeVisible()
    expect(
      box.element().querySelector('[data-thumbnail="placeholder"]')
    ).not.toBeNull()
  })

  it('never runs script carried by a drawing', async () => {
    const box = await card({
      docId: 'a3',
      type: 'architecture',
      content: '',
      thumbnail: hostile,
    })
    await expect
      .element(box.getByText('Empty canvas').or(box.getByText(/element/)))
      .toBeVisible()
    const html = box.element().innerHTML
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onload')
    expect((window as { __pwned?: boolean }).__pwned).toBeUndefined()
  })
})

describe('a stored SVG thumbnail on any document', () => {
  it('is cleaned before it is shown', async () => {
    const box = await card({
      docId: 'd1',
      type: 'mermaid',
      content: 'graph TD; A-->B',
      thumbnail: hostile,
    })
    await expect.poll(() => box.element().querySelector('svg')).not.toBeNull()
    const html = box.element().innerHTML
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onload')
    expect((window as { __pwned?: boolean }).__pwned).toBeUndefined()
  })
})
