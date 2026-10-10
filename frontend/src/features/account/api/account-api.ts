import { apiFetch } from '@/lib/api-client'

export type ProfileInput = {
  fullName: string
  phoneNumber: string
  bio: string
}

export async function updateProfileApi(input: ProfileInput) {
  await apiFetch('/api/v1/users/me/profile', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}
export async function uploadAvatarApi(picture: Blob) {
  const form = new FormData()
  form.append(
    'file',
    picture,
    picture.type === 'image/webp' ? 'avatar.webp' : 'avatar.jpg'
  )
  await apiFetch('/api/v1/users/me/avatar', { method: 'PUT', body: form })
}
export async function removeAvatarApi() {
  await apiFetch('/api/v1/users/me/avatar', { method: 'DELETE' })
}
