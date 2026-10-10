import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { registerSchema } from '@/features/auth/api/auth-schema'
import { useCurrentProfile } from '@/features/auth/hooks/use-current-profile'
import { SignInMethods } from '@/features/auth/sign-in-methods'
import { updateProfileApi, type ProfileInput } from './api/account-api'
import { AvatarEditor } from './avatar-editor'

const PHONE_MAX = 30

/** The first thing wrong with the profile, in words that say how to fix it. */
function firstProblem(values: ProfileInput) {
  const name = registerSchema.shape.fullName.safeParse(values.fullName)
  if (!name.success) return name.error.issues[0]?.message ?? 'Check the name.'
  if ([...values.phoneNumber].length > PHONE_MAX)
    return `Phone number must be at most ${PHONE_MAX} characters.`
  return ''
}

/** `linked`, `linkError` and `passwordResult` are what the address says after connecting an account or changing the password. */
export function AccountPage({
  linked,
  linkError,
  passwordResult,
}: {
  linked?: string
  linkError?: string
  passwordResult?: 'set' | 'changed'
}) {
  const user = useCurrentProfile()
  const queryClient = useQueryClient()
  const baseline: ProfileInput = {
    fullName: user.name,
    phoneNumber: user.phoneNumber,
    bio: user.bio,
  }
  // The form shows the profile until the User types; saving hands it back.
  const [draft, setDraft] = useState<ProfileInput | null>(null)
  const [problem, setProblem] = useState('')
  const values = draft ?? baseline
  const dirty =
    draft !== null &&
    (draft.fullName !== baseline.fullName ||
      draft.phoneNumber !== baseline.phoneNumber ||
      draft.bio !== baseline.bio)
  const unavailable = !!user.error
  const save = useMutation({
    mutationFn: () => updateProfileApi(values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
      setDraft(null)
    },
    retry: false,
  })

  function change(patch: Partial<ProfileInput>) {
    save.reset()
    setProblem('')
    setDraft({ ...values, ...patch })
  }
  function submit(event: React.FormEvent) {
    event.preventDefault()
    const found = firstProblem(values)
    setProblem(found)
    if (!found) save.mutate()
  }

  return (
    <main className='flex flex-1 flex-col overflow-y-auto p-6'>
      <div className='mx-auto w-full max-w-4xl space-y-8'>
        <div className='space-y-1'>
          <h1 className='text-xl font-bold'>Account</h1>
          <p className='text-sm text-muted-foreground'>
            Your profile and how you sign in.
          </p>
        </div>
        {user.isPending && <p role='status'>Loading profile...</p>}
        {user.error && (
          <div role='alert'>
            Profile unavailable. Showing your signed-in email.{' '}
            <Button variant='link' onClick={() => void user.retry()}>
              Retry
            </Button>
          </div>
        )}
        <section aria-labelledby='profile' className='space-y-4'>
          <h2 id='profile' className='text-lg font-medium'>
            Profile
          </h2>
          <AvatarEditor
            name={user.name}
            avatar={user.avatar}
            initials={user.initials}
          />
          <form onSubmit={submit} className='space-y-4' noValidate>
            <div className='space-y-2'>
              <Label htmlFor='full-name'>Full Name</Label>
              <Input
                id='full-name'
                value={values.fullName}
                readOnly={unavailable}
                onChange={(event) => change({ fullName: event.target.value })}
                aria-invalid={!!problem}
              />
            </div>
            <div className='space-y-1'>
              <p className='text-sm font-medium'>Email</p>
              <p>{user.email}</p>
              <p className='text-sm text-muted-foreground'>
                Changing your email is not available yet.
              </p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='phone-number'>Phone Number</Label>
              <Input
                id='phone-number'
                type='tel'
                value={values.phoneNumber}
                readOnly={unavailable}
                onChange={(event) =>
                  change({ phoneNumber: event.target.value })
                }
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='profile-bio'>Bio</Label>
              <Textarea
                id='profile-bio'
                value={values.bio}
                readOnly={unavailable}
                onChange={(event) => change({ bio: event.target.value })}
              />
            </div>
            {(problem || save.isError) && (
              <p role='alert' className='text-sm text-destructive'>
                {problem ||
                  (save.error instanceof ApiError && save.error.title
                    ? save.error.title
                    : 'Could not save the profile.')}
              </p>
            )}
            {save.isSuccess && !dirty && (
              <p role='status' className='text-sm'>
                Profile saved.
              </p>
            )}
            <Button
              type='submit'
              variant='signal'
              disabled={!dirty || save.isPending || unavailable}
            >
              Save Changes
            </Button>
          </form>
        </section>
        <SignInMethods
          linked={linked}
          linkError={linkError}
          passwordResult={passwordResult}
        />
      </div>
    </main>
  )
}
