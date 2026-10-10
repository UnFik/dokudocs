import { useMutation } from '@tanstack/react-query'
import { synchronizeSession, useAuthStore } from '@/stores/auth-store'
import { safeRedirect } from '@/lib/auth-guard'
import { Button } from '@/components/ui/button'
import { startGoogleApi } from './api/auth-api'
import { GoogleIcon } from './google-icon'

export function GoogleButton({
  redirectTo,
  disabled,
}: {
  redirectTo?: string
  disabled?: boolean
}) {
  const mutation = useMutation({
    mutationFn: async () => {
      const revision = useAuthStore.getState().auth.revision
      const result = await startGoogleApi(safeRedirect(redirectTo))
      synchronizeSession()
      if (useAuthStore.getState().auth.revision !== revision)
        throw new Error('Session changed. Please try again.')
      window.location.assign(result.authorizationUrl)
    },
    retry: false,
  })
  return (
    <>
      <Button
        variant='outline'
        type='button'
        disabled={disabled || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        <GoogleIcon />
        {mutation.isPending
          ? 'Connecting to Google...'
          : 'Continue with Google'}
      </Button>
      {mutation.error && (
        <p role='alert' className='text-sm text-destructive'>
          {mutation.error.message}
        </p>
      )}
    </>
  )
}
