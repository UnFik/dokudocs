import { describe, expect, it } from 'vitest'
import { CHAT_COLUMN_WIDTH, clampChatColumnWidth } from './chat-column-width'

describe('the width of the document chat column', () => {
  it('starts at the 24rem it had before it could be dragged', () => {
    expect(CHAT_COLUMN_WIDTH.default).toBe(384)
  })

  it('keeps a width inside the range the column can take', () => {
    expect(clampChatColumnWidth(200)).toBe(320)
    expect(clampChatColumnWidth(500)).toBe(500)
    expect(clampChatColumnWidth(900)).toBe(640)
  })

  it('rounds a dragged width to whole pixels', () => {
    expect(clampChatColumnWidth(401.6)).toBe(402)
  })
})
