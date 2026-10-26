import type { Muya } from '../../index'
import './index.css'

function position(source: Element, ele: HTMLElement) {
  const rect = source.getBoundingClientRect()
  const { top, right, height } = rect

  Object.assign(ele.style, {
    top: `${top + height + 15}px`,
    left: `${right - ele.offsetWidth / 2 - 10}px`,
  })
}

class Tooltip {
  private _muya: Muya
  private _cache: WeakMap<HTMLElement, HTMLElement>

  constructor(muya: Muya) {
    this._muya = muya
    this._cache = new WeakMap()
    const { domNode, eventCenter } = this._muya

    eventCenter.attachDOMEvent(domNode, 'mouseover', this._mouseOver.bind(this))
  }

  private _mouseOver(event: Event) {
    const target = event.target as HTMLElement
    const toolTipTarget = target.closest<HTMLElement>('[data-tooltip]')
    const { eventCenter } = this._muya
    if (toolTipTarget && !this._cache.has(toolTipTarget)) {
      const tooltip = toolTipTarget.getAttribute('data-tooltip')
      const tooltipEle = document.createElement('div')
      tooltipEle.textContent = tooltip
      tooltipEle.classList.add('mu-tooltip')
      document.body.appendChild(tooltipEle)
      position(toolTipTarget, tooltipEle)

      this._cache.set(toolTipTarget, tooltipEle)

      setTimeout(() => {
        tooltipEle.classList.add('active')
      })

      const timer = setInterval(() => {
        if (!document.body.contains(toolTipTarget)) {
          this._mouseLeave({ target: toolTipTarget })
          clearInterval(timer)
        }
      }, 300)

      eventCenter.attachDOMEvent(
        toolTipTarget,
        'mouseleave',
        this._mouseLeave.bind(this)
      )
    }
  }

  private _mouseLeave(event: { target: EventTarget | null }) {
    const target = event.target as HTMLElement
    if (this._cache.has(target)) {
      const tooltipEle = this._cache.get(target)
      tooltipEle?.remove()
      this._cache.delete(target)
    }
  }
}

export default Tooltip
