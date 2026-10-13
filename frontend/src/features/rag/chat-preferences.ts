import { useState } from 'react'
import { z } from 'zod'

const KEY = 'dokudocs.chat-preferences'

const preferencesSchema = z.object({ sound: z.boolean(), browser: z.boolean() })

export type ChatPreferences = z.infer<typeof preferencesSchema>

const off: ChatPreferences = { sound: false, browser: false }

/** What the User switched on for this browser; both start off. */
export function readChatPreferences(): ChatPreferences {
  try {
    const stored = localStorage.getItem(KEY)
    if (!stored) return off
    const parsed = preferencesSchema.safeParse(JSON.parse(stored))
    return parsed.success ? parsed.data : off
  } catch {
    return off
  }
}

export function writeChatPreferences(preferences: ChatPreferences) {
  try {
    localStorage.setItem(KEY, JSON.stringify(preferences))
  } catch {
    // Storage is blocked: the switches work until the page reloads.
  }
}

/** The switches as state: a change is stored at once. */
export function useChatPreferences() {
  const [preferences, setPreferences] = useState(readChatPreferences)
  const change = (patch: Partial<ChatPreferences>) => {
    const next = { ...preferences, ...patch }
    setPreferences(next)
    writeChatPreferences(next)
  }
  return [preferences, change] as const
}
