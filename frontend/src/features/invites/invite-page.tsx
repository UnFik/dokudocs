import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ApiError } from '@/lib/api-client'
import { previewInvite } from '@/lib/domain-api'
import { Button } from '@/components/ui/button'
import { forgetInvite, recallInvite } from './pending-invite'

/** What a signed-out person sees after opening the link from the invitation email. */
export function InvitePage() {
  const token = recallInvite()
  const preview = useQuery({
    queryKey: ['invite-preview', token],
    queryFn: ({ signal }) => previewInvite(token!, signal),
    enabled: Boolean(token),
    retry: false,
  })

  return (
    <main className='mx-auto grid min-h-svh max-w-md content-center gap-4 p-6'>
      {!token ? (
        <>
          <h1 className='text-xl font-semibold'>Open the invitation link</h1>
          <p className='text-sm text-muted-foreground'>
            This page works from the link in your invitation email. Open that
            link again to join.
          </p>
        </>
      ) : preview.isPending ? (
        <p role='status' className='text-sm text-muted-foreground'>
          Checking your invitation…
        </p>
      ) : preview.isError ? (
        <>
          <h1 className='text-xl font-semibold'>
            {preview.error instanceof ApiError && preview.error.status === 404
              ? 'This invitation is no longer valid'
              : 'Could not check your invitation'}
          </h1>
          <p role='alert' className='text-sm text-muted-foreground'>
            {preview.error instanceof ApiError && preview.error.status === 404
              ? 'It may have expired, been used, or been withdrawn. Ask the person who invited you to send a new one.'
              : 'Check your connection and reload this page.'}
          </p>
          <div>
            <Button
              asChild
              variant='outline'
              onClick={() => {
                if (
                  preview.error instanceof ApiError &&
                  preview.error.status === 404
                )
                  forgetInvite()
              }}
            >
              <Link to='/sign-in'>Go to sign in</Link>
            </Button>
          </div>
        </>
      ) : (
        <>
          <h1 className='text-xl font-semibold'>
            Join {preview.data.workspaceName}
          </h1>
          <p className='text-sm text-muted-foreground'>
            {preview.data.inviterName} invited you to this workspace as{' '}
            <span className='font-mono text-foreground'>
              {preview.data.role}
            </span>
            . Sign in or create an account with{' '}
            <span className='font-mono text-foreground'>
              {preview.data.email}
            </span>{' '}
            to accept.
          </p>
          <div className='flex flex-wrap gap-2'>
            <Button asChild variant='signal'>
              <Link to='/sign-up'>Create an account</Link>
            </Button>
            <Button asChild variant='outline'>
              <Link to='/sign-in'>Sign in</Link>
            </Button>
          </div>
        </>
      )}
    </main>
  )
}
