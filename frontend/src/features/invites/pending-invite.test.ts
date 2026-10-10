import { afterEach, expect, it } from 'vitest'
import {
  forgetInvite,
  recallInvite,
  rememberInvite,
  takeInviteFromAddress,
} from './pending-invite'

afterEach(() => forgetInvite())

it('keeps the token for this tab and forgets it on request', () => {
  expect(recallInvite()).toBeNull()
  rememberInvite('abc')
  expect(recallInvite()).toBe('abc')
  forgetInvite()
  expect(recallInvite()).toBeNull()
})

it('moves the token out of the address bar into storage', () => {
  const original = window.location.href
  history.replaceState(history.state, '', '/invite?token=abc_-123')
  try {
    expect(takeInviteFromAddress()).toBe('abc_-123')
    expect(window.location.search).toBe('')
    expect(window.location.pathname).toBe('/invite')
    // Reloading the cleaned address still finds it.
    expect(takeInviteFromAddress()).toBe('abc_-123')
  } finally {
    history.replaceState(history.state, '', original)
  }
})
