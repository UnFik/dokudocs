import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil } from 'lucide-react'
import { ApiError } from '@/lib/api-client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { removeAvatarApi, uploadAvatarApi } from './api/account-api'
import { AVATAR_TYPES, resizeAvatar } from './lib/resize-avatar'

function uploadMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 413)
      return 'That picture is too large. Choose a smaller one.'
    if (error.status === 400) return 'Use a PNG, JPEG or WebP picture.'
  }
  if (error instanceof Error && !(error instanceof ApiError))
    return 'That file could not be read as a picture.'
  return 'Could not save the photo. Try again.'
}

/**
 * The profile photo. Clicking it opens the file picker; the chosen picture is
 * cut square, shrunk, and saved at once, apart from the Save Changes button.
 */
export function AvatarEditor({
  name,
  avatar,
  initials,
}: {
  name: string
  avatar: string
  initials: string
}) {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState('')
  const saved = () => queryClient.invalidateQueries({ queryKey: ['profile'] })
  const upload = useMutation({
    mutationFn: async (file: File) => uploadAvatarApi(await resizeAvatar(file)),
    onSuccess: saved,
    retry: false,
  })
  const remove = useMutation({
    mutationFn: removeAvatarApi,
    onSuccess: saved,
    retry: false,
  })
  const busy = upload.isPending || remove.isPending
  const failure =
    problem ||
    (upload.isError && uploadMessage(upload.error)) ||
    (remove.isError && 'Could not remove the photo. Try again.')

  function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!AVATAR_TYPES.includes(file.type)) {
      setProblem('Choose a PNG, JPEG or WebP picture.')
      return
    }
    setProblem('')
    remove.reset()
    upload.mutate(file)
  }

  return (
    <div className='flex items-center gap-4'>
      <button
        type='button'
        aria-label='Change profile photo'
        aria-busy={busy}
        disabled={busy}
        onClick={() => input.current?.click()}
        className='group relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
      >
        <Avatar className='size-20'>
          <AvatarImage
            src={avatar}
            alt=''
            className='transition-opacity duration-[120ms] group-hover:opacity-50 group-focus-visible:opacity-50 group-disabled:opacity-50 motion-reduce:transition-none'
          />
          <AvatarFallback aria-label={name}>{initials}</AvatarFallback>
        </Avatar>
        <span
          data-slot='avatar-edit-overlay'
          className='pointer-events-none absolute inset-0 grid place-items-center rounded-full bg-background/60 text-foreground opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-visible:opacity-100 group-disabled:opacity-100 motion-reduce:transition-none'
        >
          {busy ? (
            <Loader2 className='size-5 animate-spin' strokeWidth={1.5} />
          ) : (
            <Pencil className='size-5' strokeWidth={1.5} />
          )}
        </span>
        <span
          aria-hidden='true'
          className='absolute -right-0.5 -bottom-0.5 hidden size-6 place-items-center rounded-full border bg-card text-foreground [@media(hover:none)]:grid'
        >
          <Pencil className='size-3.5' strokeWidth={1.5} />
        </span>
      </button>
      <input
        ref={input}
        type='file'
        accept={AVATAR_TYPES.join(',')}
        onChange={choose}
        tabIndex={-1}
        aria-hidden='true'
        className='sr-only'
      />
      <div className='space-y-1'>
        <p className='text-sm font-medium'>Profile photo</p>
        <p className='text-sm text-muted-foreground'>PNG, JPEG or WebP.</p>
        {avatar && (
          <Button
            variant='outline'
            size='sm'
            disabled={busy}
            onClick={() => {
              setProblem('')
              upload.reset()
              remove.mutate()
            }}
          >
            Remove photo
          </Button>
        )}
        {failure && (
          <p role='alert' className='text-sm text-destructive'>
            {failure}
          </p>
        )}
      </div>
    </div>
  )
}
