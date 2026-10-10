import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  checkPasswordLinkApi,
  setPasswordApi,
  signInMethodsApi,
} from '../api/auth-api'
import { registerSchema } from '../api/auth-schema'
import { takePasswordLinkToken } from './password-link'

type Outcome = 'set' | 'changed'

const INVALID_LINK = 'This link is invalid or has expired.'

/**
 * The check answers 400 for a link that is no good. Saving also answers 400 for
 * a password that breaks the rules, so there the server's words tell them apart.
 */
const isBadLink = (error: unknown) =>
  error instanceof ApiError && error.status === 400
const isBadLinkOnSave = (error: unknown) =>
  isBadLink(error) && /link/i.test((error as ApiError).title)

/**
 * Where the link in the password email lands. It checks the link first, so the
 * User does not type a password into a page that will refuse it, then takes the
 * new password twice. `onLeave` gets the outcome, or nothing for "back".
 */
export function SetPasswordPage({
  onLeave,
}: {
  onLeave: (outcome?: Outcome) => void
}) {
  const user = useAuthStore((state) => state.auth.user)
  const queryClient = useQueryClient()
  const [token] = useState(takePasswordLinkToken)
  const methods = useQuery({
    queryKey: ['sign-in-methods', user?.id],
    queryFn: ({ signal }) => signInMethodsApi(signal),
    enabled: !!user,
    retry: false,
  })
  const check = useQuery({
    queryKey: ['password-link', token],
    // A query cannot resolve to undefined, and the check answers with no body.
    queryFn: async ({ signal }) => {
      await checkPasswordLinkApi(token ?? '', signal)
      return true
    },
    enabled: !!token,
    retry: false,
    gcTime: 0,
  })
  const hasPassword = methods.data?.hasPassword ?? false
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [shown, setShown] = useState(false)
  const [problem, setProblem] = useState('')
  const save = useMutation({
    mutationFn: () => setPasswordApi(token ?? '', password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['sign-in-methods', user?.id],
      })
      onLeave(hasPassword ? 'changed' : 'set')
    },
    retry: false,
  })

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = registerSchema.shape.password.safeParse(password)
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Invalid password.')
      return
    }
    if (password !== confirmation) {
      setProblem('Passwords do not match.')
      return
    }
    setProblem('')
    save.mutate()
  }

  const title = hasPassword ? 'Change password' : 'Set password'
  const refused =
    !token ||
    (check.isError && isBadLink(check.error)) ||
    isBadLinkOnSave(save.error)

  let body
  if (!token) {
    body = (
      <div role='alert' className='space-y-3'>
        <p>Open the link from your email to set a password.</p>
        <Button variant='outline' onClick={() => onLeave()}>
          Back to account
        </Button>
      </div>
    )
  } else if (refused) {
    body = (
      <div role='alert' className='space-y-3'>
        <p>{INVALID_LINK} Ask for a new one from your account.</p>
        <Button variant='outline' onClick={() => onLeave()}>
          Back to account
        </Button>
      </div>
    )
  } else if (check.isError) {
    body = (
      <div role='alert' className='space-y-3'>
        <p>Could not check the link. Try again.</p>
        <Button variant='outline' onClick={() => void check.refetch()}>
          Try again
        </Button>
      </div>
    )
  } else if (check.isPending || methods.isPending) {
    body = <p role='status'>Checking your link...</p>
  } else {
    const type = shown ? 'text' : 'password'
    const error =
      problem ||
      (save.isError
        ? save.error instanceof ApiError && save.error.title
          ? save.error.title
          : 'Could not save the password.'
        : '')
    body = (
      <form onSubmit={submit} className='space-y-4' noValidate>
        <input
          type='text'
          name='username'
          autoComplete='username'
          value={user?.email ?? ''}
          readOnly
          tabIndex={-1}
          aria-hidden='true'
          className='sr-only'
        />
        <div className='space-y-2'>
          <Label htmlFor='new-password'>New password</Label>
          <div className='flex gap-2'>
            <Input
              id='new-password'
              type={type}
              autoComplete='new-password'
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={!!error}
              aria-describedby='password-rules'
            />
            <Button
              type='button'
              variant='outline'
              size='icon'
              aria-label={shown ? 'Hide password' : 'Show password'}
              aria-pressed={shown}
              onClick={() => setShown((value) => !value)}
            >
              {shown ? <EyeOff /> : <Eye />}
            </Button>
          </div>
          <p id='password-rules' className='text-sm text-muted-foreground'>
            At least 15 characters.
          </p>
        </div>
        <div className='space-y-2'>
          <Label htmlFor='confirm-password'>Confirm password</Label>
          <Input
            id='confirm-password'
            type={type}
            autoComplete='new-password'
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            aria-invalid={!!error}
          />
        </div>
        {error && (
          <p role='alert' className='text-sm text-destructive'>
            {error}
          </p>
        )}
        <div className='flex flex-wrap gap-2'>
          <Button type='submit' variant='signal' disabled={save.isPending}>
            {title}
          </Button>
          <Button type='button' variant='outline' onClick={() => onLeave()}>
            Cancel
          </Button>
        </div>
      </form>
    )
  }

  return (
    <main className='flex flex-1 flex-col overflow-y-auto p-6'>
      <div className='mx-auto w-full max-w-md space-y-6'>
        <h1 className='text-xl font-bold'>{title}</h1>
        {body}
      </div>
    </main>
  )
}
