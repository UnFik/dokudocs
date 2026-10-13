import { beforeEach, describe, expect, it } from 'vitest'
import { readChatPreferences, writeChatPreferences } from './chat-preferences'

describe('chat preferences', () => {
  beforeEach(() => localStorage.clear())

  it('starts with both notifications off', () => {
    expect(readChatPreferences()).toEqual({ sound: false, browser: false })
  })

  it('remembers what was switched on', () => {
    writeChatPreferences({ sound: true, browser: false })
    expect(readChatPreferences()).toEqual({ sound: true, browser: false })
  })

  it('ignores a stored value it does not understand', () => {
    localStorage.setItem('dokudocs.chat-preferences', '{"sound":"yes"}')
    expect(readChatPreferences()).toEqual({ sound: false, browser: false })
  })

  it('still works when storage throws', () => {
    const original = Storage.prototype.getItem
    Storage.prototype.getItem = () => {
      throw new Error('blocked')
    }
    try {
      expect(readChatPreferences()).toEqual({ sound: false, browser: false })
    } finally {
      Storage.prototype.getItem = original
    }
  })
})
