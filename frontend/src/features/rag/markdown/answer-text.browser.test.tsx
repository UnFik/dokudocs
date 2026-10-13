import '@/styles/index.css'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { AnswerText } from './answer-text'

const id = '3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f'

afterEach(() => vi.unstubAllGlobals())

it('draws bold, lists, quotes, headings and inline code instead of their marks', async () => {
  const screen = await render(
    <AnswerText
      content={
        '# Plan\n\nUse **two** brokers and `make test`.\n\n- first\n- second\n\n1. one\n2. two\n\n> careful\n\n---\n\n~~old~~'
      }
    />
  )
  await expect
    .element(screen.getByRole('heading', { name: 'Plan' }))
    .toBeVisible()
  expect(document.body.textContent).not.toContain('**')
  expect(document.querySelector('strong')?.textContent).toBe('two')
  expect(document.querySelector('code')?.textContent).toBe('make test')
  expect(document.querySelectorAll('ul > li')).toHaveLength(2)
  expect(document.querySelectorAll('ol > li')).toHaveLength(2)
  expect(document.querySelector('blockquote')?.textContent).toContain('careful')
  expect(document.querySelector('hr')).not.toBeNull()
  expect(document.querySelector('del')?.textContent).toBe('old')
})

it('draws a task list with checkboxes the reader cannot change', async () => {
  await render(<AnswerText content={'- [x] done\n- [ ] later'} />)
  const boxes = document.querySelectorAll<HTMLInputElement>(
    'input[type=checkbox]'
  )
  expect(boxes).toHaveLength(2)
  expect([...boxes].map((box) => box.checked)).toEqual([true, false])
  expect([...boxes].every((box) => box.disabled)).toBe(true)
})

it('draws a table that scrolls on its own, so a wide one cannot push the page', async () => {
  const wide = `| name | ${'long header '.repeat(30)} |\n| --- | --- |\n| a | b |`
  const screen = await render(
    <div style={{ width: 280 }}>
      <AnswerText content={wide} />
    </div>
  )
  await expect.element(screen.getByRole('table')).toBeVisible()
  const wrapper = document.querySelector('table')!.parentElement!
  expect(getComputedStyle(wrapper).overflowX).toBe('auto')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    document.documentElement.clientWidth
  )
})

it('draws a code block with its language, copies it, and says so', async () => {
  const writeText = vi.fn(async () => undefined)
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  const screen = await render(
    <AnswerText content={'```go\nfmt.Println("hi")\n```'} />
  )
  await expect.element(screen.getByText('go', { exact: true })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: /copy/i }))
  await vi.waitFor(() =>
    expect(writeText).toHaveBeenCalledWith('fmt.Println("hi")')
  )
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('Code copied')
})

it('colours a block whose language it knows and leaves other blocks plain', async () => {
  await render(
    <AnswerText content={'```json\n{"a": 1}\n```\n\n```nope\nx y\n```'} />
  )
  await vi.waitFor(() =>
    expect(document.querySelector('.token.number')).not.toBeNull()
  )
  const plain = [...document.querySelectorAll('pre code')].at(-1)!
  expect(plain.textContent).toBe('x y')
  expect(plain.querySelector('.token')).toBeNull()
})

it('opens outside links in a new tab without handing over the opener', async () => {
  const screen = await render(
    <AnswerText content='See [the site](https://example.com/a) or [mail](mailto:a@b.co).' />
  )
  const link = screen.getByRole('link', { name: 'the site' })
  await expect.element(link).toHaveAttribute('href', 'https://example.com/a')
  await expect.element(link).toHaveAttribute('target', '_blank')
  await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer')
})

it('shows unsafe links as plain text, never as links', async () => {
  const screen = await render(
    <AnswerText
      content={
        '[run](javascript:alert(1)) [data](data:text/html;base64,AAAA) [odd](/settings) [bad](doc:not-an-id)'
      }
    />
  )
  await expect.element(screen.getByText(/run/)).toBeVisible()
  expect(document.querySelectorAll('a')).toHaveLength(0)
})

it('never loads an image from the answer', async () => {
  await render(
    <AnswerText content={'![a chart](https://evil.example/p.png?x=1)'} />
  )
  expect(document.querySelector('img')).toBeNull()
  expect(document.body.textContent).toContain('a chart')
})

it('shows raw HTML as text instead of running it', async () => {
  const screen = await render(
    <AnswerText content={'<script>window.hacked = 1</script> <b>x</b>'} />
  )
  expect(screen.container.querySelector('script')).toBeNull()
  expect(screen.container.querySelector('b')).toBeNull()
  expect(screen.container.textContent).toContain('<b>x</b>')
  expect((window as { hacked?: number }).hacked).toBeUndefined()
})

it('hands a doc: link to the page, and shows its label as text when the page has no taker', async () => {
  const link = `see [Runbook](doc:${id})`
  const withTaker = await render(
    <AnswerText
      content={link}
      renderDocument={(documentID, label) => (
        <a href={`/docs/${documentID}`}>{label}</a>
      )}
    />
  )
  await expect
    .element(withTaker.getByRole('link', { name: 'Runbook' }))
    .toHaveAttribute('href', `/docs/${id}`)
  await withTaker.unmount()
  const without = await render(<AnswerText content={link} />)
  await expect.element(without.getByText(/Runbook/)).toBeVisible()
  expect(document.querySelectorAll('a')).toHaveLength(0)
})

it('keeps a half-written answer readable while it streams', async () => {
  const screen = await render(
    <AnswerText streaming content={'Run:\n\n```bash\nmake te'} />
  )
  await expect.element(screen.getByText('make te')).toBeVisible()
  expect(document.querySelectorAll('pre')).toHaveLength(1)
  await screen.rerender(
    <AnswerText streaming content={'so **really important'} />
  )
  expect(document.querySelector('strong')?.textContent).toBe('really important')
  await screen.rerender(<AnswerText streaming content={'see [Run'} />)
  expect(document.body.textContent).toContain('see Run')
  expect(document.body.textContent).not.toContain('[')
})
