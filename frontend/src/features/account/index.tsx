import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCurrentProfile } from '@/features/auth/hooks/use-current-profile'
import { SignInMethods } from '@/features/auth/sign-in-methods'

/** `linked` and `linkError` are what the server put in the address after connecting an account. */
export function AccountPage({
  linked,
  linkError,
}: {
  linked?: string
  linkError?: string
}) {
  const user = useCurrentProfile()
  return (
    <main className='flex flex-1 flex-col overflow-y-auto p-6'>
      <div className='mx-auto w-full max-w-4xl space-y-6'>
        <h1 className='text-xl font-bold'>Account</h1>
        <p className='text-sm text-muted-foreground'>
          Your profile. Profile editing and avatar uploads are not available
          yet.
        </p>
        {user.isPending && <p role='status'>Loading profile...</p>}
        {user.error && (
          <div role='alert'>
            Profile unavailable. Showing your signed-in email.{' '}
            <Button variant='link' onClick={() => void user.retry()}>
              Retry
            </Button>
          </div>
        )}
        <Avatar className='size-16'>
          <AvatarImage src={user.avatar} alt={user.name} />
          <AvatarFallback>{user.initials}</AvatarFallback>
        </Avatar>
        <div className='space-y-2'>
          <Label htmlFor='full-name'>Full Name</Label>
          <Input id='full-name' value={user.name} readOnly />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='profile-email'>Email Address</Label>
          <Input id='profile-email' value={user.email} readOnly />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='phone-number'>Phone Number</Label>
          <Input id='phone-number' value={user.phoneNumber} readOnly />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='profile-bio'>Bio</Label>
          <Textarea id='profile-bio' value={user.bio} readOnly />
        </div>
        <Button disabled>Save Changes (not available)</Button>
        <SignInMethods linked={linked} linkError={linkError} />
      </div>
    </main>
  )
}
