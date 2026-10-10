import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  setPasswordApi,
  signInMethodsApi,
  startGoogleApi,
  unlinkIdentityApi,
} from '../api/auth-api'
import { registerSchema } from '../api/auth-schema'

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
  navigate = (url: string) => window.location.assign(url),
}: {
  linked?: string
  linkError?: string
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
  const disconnect = useMutation({
    mutationFn: () => unlinkIdentityApi('google'),
    onSuccess: refresh,
    retry: false,
  })
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const setNewPassword = useMutation({
    mutationFn: (value: string) => setPasswordApi(value),
    onSuccess: () => {
      setPassword('')
      return refresh()
    },
    retry: false,
  })
  const result = linkResult(linked, linkError)
  const google = methods.data?.identities.find((i) => i.provider === 'google')

  function submitPassword(event: React.FormEvent) {
    event.preventDefault()
    const parsed = registerSchema.shape.password.safeParse(password)
    if (!parsed.success) {
      setPasswordError(parsed.error.issues[0]?.message ?? 'Invalid password.')
      return
    }
    setPasswordError('')
    setNewPassword.mutate(password)
  }

  return (
    <section aria-labelledby='sign-in-methods' className='space-y-4'>
      <h2 id='sign-in-methods' className='text-lg font-medium'>
        Sign-in methods
      </h2>
      {result && <p role={result.role}>{result.text}</p>}
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
            <div>
              <p className='font-medium'>Google</p>
              <p className='text-sm text-muted-foreground'>
                {google ? google.email : 'Not connected'}
              </p>
            </div>
            {google ? (
              <Button
                variant='outline'
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Disconnect Google
              </Button>
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
          {disconnect.isError && (
            <p role='alert'>
              {errorTitle(disconnect.error, 'Could not disconnect Google.')}
            </p>
          )}
          {methods.data.hasPassword ? (
            <p className='text-sm text-muted-foreground'>
              You can sign in with your email and password.
            </p>
          ) : (
            <form onSubmit={submitPassword} className='space-y-2' noValidate>
              <Label htmlFor='new-password'>New password</Label>
              <Input
                id='new-password'
                type='password'
                autoComplete='new-password'
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={!!passwordError}
              />
              <p className='text-sm text-muted-foreground'>
                You sign in with Google only. Set a password to also sign in
                with your email.
              </p>
              {(passwordError || setNewPassword.isError) && (
                <p role='alert'>
                  {passwordError ||
                    errorTitle(
                      setNewPassword.error,
                      'Could not set the password.'
                    )}
                </p>
              )}
              <Button type='submit' disabled={setNewPassword.isPending}>
                Set password
              </Button>
            </form>
          )}
          {setNewPassword.isSuccess && <p role='status'>Password set.</p>}
        </>
      )}
    </section>
  )
}
