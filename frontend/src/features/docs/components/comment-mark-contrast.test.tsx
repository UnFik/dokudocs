import '@/styles/theme.css'
import { afterEach, describe, expect, it } from 'vitest'
import './markdown-body.css'

function rgba(value: string) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  return [...context.getImageData(0, 0, 1, 1).data] as [
    number,
    number,
    number,
    number,
  ]
}

function luminance([r, g, b]: number[]) {
  const channel = (value: number) => {
    const s = value / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!)
}

function contrast(a: number[], b: number[]) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

afterEach(() => {
  document.documentElement.classList.remove('dark')
  document.body.replaceChildren()
})

describe('commented text', () => {
  it.each([
    ['light', false],
    ['dark', true],
  ])(
    'keeps the text readable and the mark visible in the %s theme',
    (_, dark) => {
      document.documentElement.classList.toggle('dark', dark)
      const host = document.createElement('div')
      host.className = 'markdown-body'
      host.style.background = 'var(--background)'
      host.innerHTML =
        '<p><span class="comment-mark">commented</span> plain</p><p><span class="comment-mark comment-focus">focused</span></p>'
      document.body.append(host)
      const page = rgba(getComputedStyle(host).backgroundColor)
      const over = (el: Element) => {
        const layer = rgba(getComputedStyle(el).backgroundColor)
        const a = layer[3]! / 255
        return [0, 1, 2].map((i) =>
          Math.round(layer[i]! * a + page[i]! * (1 - a))
        )
      }
      for (const el of host.querySelectorAll('.comment-mark')) {
        const text = rgba(getComputedStyle(el).color)
        expect(contrast(text, over(el))).toBeGreaterThanOrEqual(4.5)
      }
      // The mark is told apart from the page by its underline.
      const mark = host.querySelector('.comment-mark')!
      expect(getComputedStyle(mark).borderBottomWidth).toBe('2px')
      expect(
        contrast(rgba(getComputedStyle(mark).borderBottomColor), page)
      ).toBeGreaterThanOrEqual(3)
    }
  )
})
