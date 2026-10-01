import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { ForgotPasswordForm } from './forgot-password-form'

it('does not offer simulated password recovery', async () => {
  const screen = await render(<ForgotPasswordForm />)
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('Password recovery is not available yet.')
  await expect.element(screen.getByRole('button')).not.toBeInTheDocument()
})
