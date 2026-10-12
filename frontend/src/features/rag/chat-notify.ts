import type { ChatPreferences } from './chat-preferences'

/** Asks the browser for permission to notify; false when it is refused or unavailable. */
export async function allowBrowserNotifications(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  return (await Notification.requestPermission()) === 'granted'
}

function beep() {
  try {
    const context = new AudioContext()
    const tone = context.createOscillator()
    const volume = context.createGain()
    tone.frequency.value = 880
    volume.gain.value = 0.08
    tone.connect(volume).connect(context.destination)
    tone.start()
    tone.stop(context.currentTime + 0.15)
    tone.onended = () => void context.close()
  } catch {
    // No audio output: the browser notification, if on, still tells them.
  }
}

/**
 * Tells the User an answer is ready, in the ways they switched on. It stays
 * quiet while they are looking at the page, since the answer is on screen.
 */
export function announceAnswer(preferences: ChatPreferences, title: string) {
  if (!document.hidden) return
  if (preferences.sound) beep()
  if (
    preferences.browser &&
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted'
  )
    new Notification('DokuDocs AI', {
      body: `${title.trim() || 'Your chat'}: the answer is ready.`,
    })
}
