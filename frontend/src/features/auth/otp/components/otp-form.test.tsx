import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { OtpForm } from './otp-form'

it('does not offer simulated OTP verification', async () => {
  const screen = await render(<OtpForm />)
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('One-time codes are not available yet.')
  await expect.element(screen.getByRole('button')).not.toBeInTheDocument()
})
