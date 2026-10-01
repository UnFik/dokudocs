import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { apiFetch } from '@/lib/api-client'

const profileSchema = z.object({
  id: z
    .string()
    .regex(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      'Invalid UUID'
    ),
  email: z.email(),
  fullName: z.string(),
  phoneNumber: z.string(),
  bio: z.string(),
  avatarUrl: z.string(),
})

export function useCurrentProfile() {
  const { user, revision, status } = useAuthStore((state) => state.auth)
  const query = useQuery({
    queryKey: ['profile', user?.id, revision],
    queryFn: async ({ signal }) => {
      const profile = profileSchema.parse(
        await apiFetch('/api/v1/users/me/profile', { signal })
      )
      if (profile.id !== user?.id)
        throw new Error('Profile does not match CurrentUser')
      return profile
    },
    enabled: status === 'authenticated',
    retry: false,
  })
  const profile = status === 'authenticated' ? query.data : undefined
  const email = profile?.email ?? user?.email ?? ''
  const name = profile?.fullName || email
  return {
    name,
    email,
    avatar: profile?.avatarUrl || '',
    initials: name.slice(0, 2).toUpperCase(),
    phoneNumber: profile?.phoneNumber ?? '',
    bio: profile?.bio ?? '',
    isPending: query.isPending,
    error: query.error,
    retry: query.refetch,
  }
}
