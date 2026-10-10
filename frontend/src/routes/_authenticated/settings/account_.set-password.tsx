import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SetPasswordPage } from '@/features/auth/set-password'

export const Route = createFileRoute(
  '/_authenticated/settings/account_/set-password'
)({
  component: SetPassword,
})

function SetPassword() {
  const navigate = useNavigate()
  return (
    <SetPasswordPage
      onLeave={(password) =>
        void navigate({
          to: '/settings/account',
          search: password ? { password } : {},
          replace: true,
        })
      }
    />
  )
}
