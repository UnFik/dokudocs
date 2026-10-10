import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { AccountPage } from '@/features/account'

export const Route = createFileRoute('/_authenticated/settings/account')({
  validateSearch: z.object({
    linked: z.string().optional().catch(undefined),
    link_error: z.string().optional().catch(undefined),
  }),
  component: SettingsAccount,
})

function SettingsAccount() {
  const { linked, link_error } = Route.useSearch()
  return <AccountPage linked={linked} linkError={link_error} />
}
