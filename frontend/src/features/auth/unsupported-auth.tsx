import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { AuthLayout } from './auth-layout'

export function UnsupportedAuth() {
  return (
    <AuthLayout>
      <div className='max-w-sm space-y-4 p-6'>
        <h1 className='text-xl font-semibold'>Not available yet</h1>
        <p>
          Password recovery and one-time codes are not supported. Sign in with
          your password or Google.
        </p>
        <Button asChild>
          <Link to='/sign-in'>Back to sign in</Link>
        </Button>
      </div>
    </AuthLayout>
  )
}
