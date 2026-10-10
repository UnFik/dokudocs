import { useMutation } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { resendVerificationApi } from '../api/auth-api'
import { VerificationLinkError } from './verification-link'

function resendMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429)
      return 'A link was sent a moment ago. Wait a minute and try again.'
    if (error.status === 503) return 'Email is not set up on this server.'
  }
  return 'Could not send the link. Try again later.'
}

/** Where a User with an unverified email lands, and the page a refused link shows. */
export function VerifyEmailPage({ error }: { error?: unknown }) {
  const user = useAuthStore((state) => state.auth.user)
  const resend = useMutation({
    mutationFn: resendVerificationApi,
    retry: false,
  })
  return (
    <main className='grid min-h-svh place-content-center gap-4 p-6'>
      <h1 className='text-xl font-semibold'>Verify your email</h1>
      {error instanceof VerificationLinkError && (
        <p role='alert'>{error.message}</p>
      )}
      {user ? (
        <>
          <p>
            We sent a link to <strong>{user.email}</strong>. Open it to start
            using Dokudocs.
          </p>
          <div className='flex flex-wrap gap-2'>
            <Button
              type='button'
              disabled={resend.isPending}
              onClick={() => resend.mutate()}
            >
              Send the link again
            </Button>
            <Button
              type='button'
              variant='outline'
              onClick={() => useAuthStore.getState().auth.reset()}
            >
              Sign out
            </Button>
          </div>
          {resend.isSuccess && <p role='status'>A new link is on its way.</p>}
          {resend.isError && <p role='alert'>{resendMessage(resend.error)}</p>}
        </>
      ) : (
        <p>Sign in again to get a new link.</p>
      )}
    </main>
  )
}
