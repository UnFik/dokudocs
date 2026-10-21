import { useState } from 'react'
import '@/styles/index.css'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { InlineField } from './inline-field'

function Harness(props: {
  initial?: string
  canEdit?: boolean
  multiline?: boolean
  onChange?: (value: string) => void
}) {
  const [value, setValue] = useState(props.initial ?? 'Zitadel API')
  return (
    <div style={{ width: 240 }}>
      <label id='f-label' htmlFor='f'>
        name
      </label>
      <InlineField
        id='f'
        value={value}
        canEdit={props.canEdit ?? true}
        multiline={props.multiline}
        placeholder='https://'
        onChange={(next) => {
          setValue(next)
          props.onChange?.(next)
        }}
      />
      <button type='button'>elsewhere</button>
    </div>
  )
}

describe('a field that is text until it is clicked', () => {
  it('shows the value as a button and turns into an input on click', async () => {
    await render(<Harness />)
    const button = page.getByRole('button', { name: /Zitadel API/ })
    await expect.element(button).toBeVisible()
    expect(document.querySelector('input')).toBeNull()
    await userEvent.click(button)
    await expect.element(page.getByRole('textbox')).toHaveFocus()
    await expect.element(page.getByRole('textbox')).toHaveValue('Zitadel API')
  })

  it('writes while typing and goes back to text on Enter', async () => {
    const onChange = vi.fn()
    await render(<Harness onChange={onChange} />)
    await userEvent.click(page.getByRole('button', { name: /Zitadel API/ }))
    await userEvent.type(page.getByRole('textbox'), ' v2')
    expect(onChange).toHaveBeenLastCalledWith('Zitadel API v2')
    await userEvent.keyboard('{Enter}')
    expect(document.querySelector('input')).toBeNull()
    await expect
      .element(page.getByRole('button', { name: /Zitadel API v2/ }))
      .toHaveFocus()
  })

  it('goes back to text when focus leaves, keeping what was typed', async () => {
    await render(<Harness />)
    await userEvent.click(page.getByRole('button', { name: /Zitadel API/ }))
    await userEvent.type(page.getByRole('textbox'), '!')
    await userEvent.click(page.getByRole('button', { name: 'elsewhere' }))
    expect(document.querySelector('input')).toBeNull()
    await expect
      .element(page.getByRole('button', { name: /Zitadel API!/ }))
      .toBeVisible()
  })

  it('puts the old value back on Escape', async () => {
    await render(<Harness />)
    await userEvent.click(page.getByRole('button', { name: /Zitadel API/ }))
    await userEvent.type(page.getByRole('textbox'), ' changed')
    await userEvent.keyboard('{Escape}')
    expect(document.querySelector('input')).toBeNull()
    await expect
      .element(page.getByRole('button', { name: 'name Zitadel API' }))
      .toBeVisible()
  })

  it('shows the placeholder, muted, for an empty value', async () => {
    await render(<Harness initial='' />)
    await expect
      .element(page.getByRole('button', { name: 'name https://' }))
      .toBeVisible()
  })

  it('is plain text, not a button, for someone who cannot edit', async () => {
    await render(<Harness canEdit={false} />)
    await expect.element(page.getByText('Zitadel API')).toBeVisible()
    expect(document.querySelector('[id="f"]')?.tagName).not.toBe('BUTTON')
  })
})

describe('a long multi-line value', () => {
  const long =
    'OIDC/OAuth, SAML, SCIM, 36 service gRPC/Connect/REST, Console static, Login v1 legacy, dan modul inti event sourcing + CQRS dalam satu proses. Struktur kode: lihat dokumen terkait (graf import Go)'

  it('is cut at two lines with an ellipsis, so what follows it stays put', async () => {
    await render(<Harness initial={long} multiline />)
    const text = page.getByRole('button', { name: /OIDC\/OAuth/ }).element()
    const style = getComputedStyle(text)
    expect(style.overflow).toBe('hidden')
    expect(
      style.webkitLineClamp || style.getPropertyValue('-webkit-line-clamp')
    ).toBe('2')
    expect(text.getBoundingClientRect().height).toBeLessThan(64)
  })

  it('opens as a textarea with the whole text, and Enter adds a line', async () => {
    await render(<Harness initial={long} multiline />)
    await userEvent.click(page.getByRole('button', { name: /OIDC\/OAuth/ }))
    const area = page.getByRole('textbox')
    await expect.element(area).toHaveValue(long)
    await userEvent.keyboard('{Enter}x')
    expect((area.element() as HTMLTextAreaElement).value).toContain('\nx')
  })

  it('goes back to text on Ctrl+Enter', async () => {
    await render(<Harness initial={long} multiline />)
    await userEvent.click(page.getByRole('button', { name: /OIDC\/OAuth/ }))
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(document.querySelector('textarea')).toBeNull()
  })
})
