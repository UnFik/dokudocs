import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { signInMethodsApi, startGoogleApi } from '../api/auth-api'
import { GoogleIcon } from '../google-icon'
import { DisconnectGoogleDialog } from './disconnect-google-dialog'
import { PasswordLinkDialog } from './password-link-dialog'

const RETURN_TO = '/settings/account'

function linkResult(linked?: string, error?: string) {
  if (linked === 'google')
    return { role: 'status' as const, text: 'Google account connected.' }
  switch (error) {
    case undefined:
      return null
    case 'identity_in_use':
      return {
        role: 'alert' as const,
        text: 'That Google account is already connected to another user.',
      }
    case 'provider_linked':
      return {
        role: 'alert' as const,
        text: 'A different Google account is already connected. Disconnect it first.',
      }
    case 'denied':
      return {
        role: 'alert' as const,
        text: 'Connecting Google was cancelled.',
      }
    default:
      return {
        role: 'alert' as const,
        text: 'The Google account could not be connected. Please try again.',
      }
  }
}

function errorTitle(error: unknown, fallback: string) {
  return error instanceof ApiError && error.title ? error.title : fallback
}

/**
 * The ways the signed-in User can sign in: password and connected accounts.
 * `linked` and `linkError` are what the server put in the address after a
 * connect attempt; `navigate` is how the page leaves for Google.
 */
export function SignInMethods({
  linked,
  linkError,
  passwordResult,
  navigate = (url: string) => window.location.assign(url),
}: {
  linked?: string
  linkError?: string
  passwordResult?: 'set' | 'changed'
  navigate?: (url: string) => void
}) {
  const user = useAuthStore((state) => state.auth.user)
  const queryClient = useQueryClient()
  const queryKey = ['sign-in-methods', user?.id]
  const methods = useQuery({
    queryKey,
    queryFn: ({ signal }) => signInMethodsApi(signal),
    enabled: !!user,
    retry: false,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey })

  const connect = useMutation({
    mutationFn: async () => {
      const { authorizationUrl } = await startGoogleApi(RETURN_TO, true)
      navigate(authorizationUrl)
    },
    retry: false,
  })
  const [passwordOpen, setPasswordOpen] = useState(false)
  const result = linkResult(linked, linkError)
  const google = methods.data?.identities.find((i) => i.provider === 'google')

  return (
    <section aria-labelledby='sign-in-methods' className='space-y-4'>
      <h2 id='sign-in-methods' className='text-lg font-medium'>
        Sign-in methods
      </h2>
      {result && <p role={result.role}>{result.text}</p>}
      {passwordResult && (
        <p role='status'>
          {passwordResult === 'set' ? 'Password set.' : 'Password changed.'}
        </p>
      )}
      {methods.isPending && <p role='status'>Loading sign-in methods...</p>}
      {methods.isError && (
        <div role='alert'>
          Could not load your sign-in methods.{' '}
          <Button variant='link' onClick={() => void methods.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {methods.data && (
        <>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div className='flex items-center gap-3'>
              <GoogleIcon />
              <div>
                <p className='font-medium'>Google</p>
                <p className='text-sm text-muted-foreground'>
                  {google ? google.email : 'Not connected'}
                </p>
              </div>
            </div>
            {google ? (
              <DisconnectGoogleDialog
                email={google.email}
                hasPassword={methods.data.hasPassword}
                onDisconnected={refresh}
                onSetPassword={() => setPasswordOpen(true)}
              />
            ) : (
              <Button
                variant='outline'
                disabled={connect.isPending}
                onClick={() => connect.mutate()}
              >
                Connect Google
              </Button>
            )}
          </div>
          {connect.isError && (
            <p role='alert'>
              {errorTitle(connect.error, 'Could not start connecting Google.')}
            </p>
          )}
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div>
              <p className='font-medium'>Password</p>
              <p className='text-sm text-muted-foreground'>
                {methods.data.hasPassword ? 'Password is set' : 'Not set'}
              </p>
            </div>
            <Button variant='outline' onClick={() => setPasswordOpen(true)}>
              {methods.data.hasPassword ? 'Change password' : 'Set password'}
            </Button>
          </div>
          <PasswordLinkDialog
            open={passwordOpen}
            onOpenChange={setPasswordOpen}
            email={user?.email ?? ''}
            hasPassword={methods.data.hasPassword}
          />
        </>
      )}
    </section>
  )
}
