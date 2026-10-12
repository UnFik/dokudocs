import { useState } from 'react'
import { allowBrowserNotifications } from './chat-notify'
import { useChatPreferences } from './chat-preferences'

/** The notification switches of the header menu, with the browser's permission handled. */
export function usePanelOptions() {
  const [preferences, change] = useChatPreferences()
  const [browserBlocked, setBrowserBlocked] = useState(
    () =>
      typeof Notification !== 'undefined' &&
      Notification.permission === 'denied'
  )
  return {
    preferences,
    browserBlocked,
    onSound: (sound: boolean) => change({ sound }),
    onBrowser: (on: boolean) => {
      if (!on) return change({ browser: false })
      void allowBrowserNotifications().then((allowed) => {
        setBrowserBlocked(!allowed)
        change({ browser: allowed })
      })
    },
  }
}
