import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { ApiError } from '@/lib/api-client'
import {
  inviteWorkspaceMember,
  listWorkspaceInvites,
  listWorkspaceRoster,
  removeWorkspaceMember,
  resendWorkspaceInvite,
  revokeWorkspaceInvite,
  type InviteRole,
} from '@/lib/domain-api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces'

const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

function inviteError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 409)
      return 'That person is already a member of this workspace.'
    if (error.status === 429)
      return 'An invitation went out a moment ago. Wait a minute and try again.'
    if (error.status === 503) return 'Email is not set up on this server.'
    if (error.status === 502)
      return 'The email could not be sent. Try again in a moment.'
    if (error.status === 403)
      return 'Only an owner can invite an admin. Choose the member role instead.'
    if (error.title) return error.title
  }
  return 'Could not send the invitation. Try again.'
}

/** Roster and invitations of the active workspace. */
export function WorkspaceMembers() {
  const { activeWorkspace } = useWorkspaces()
  const workspaceId = activeWorkspace?.id ?? ''
  const role = activeWorkspace?.role
  const isOwner = role === 'owner'
  const canManage = isOwner || role === 'admin'
  const me = useAuthStore((state) => state.auth.user?.id)
  const queryClient = useQueryClient()

  const [filter, setFilter] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<InviteRole>('member')
  const [formError, setFormError] = useState('')
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(
    null
  )

  const roster = useQuery({
    queryKey: ['workspace-roster', workspaceId],
    queryFn: ({ signal }) => listWorkspaceRoster(workspaceId, signal),
    enabled: Boolean(workspaceId),
  })
  const invites = useQuery({
    queryKey: ['workspace-invites', workspaceId],
    queryFn: ({ signal }) => listWorkspaceInvites(workspaceId, signal),
    enabled: Boolean(workspaceId) && canManage,
  })
  const refreshInvites = () =>
    queryClient.invalidateQueries({
      queryKey: ['workspace-invites', workspaceId],
    })

  const invite = useMutation({
    mutationFn: () =>
      inviteWorkspaceMember(workspaceId, {
        email: email.trim(),
        role: inviteRole,
      }),
    onSuccess: () => {
      toast.success(`Invitation sent to ${email.trim()}`)
      setInviteOpen(false)
      setEmail('')
      setInviteRole('member')
      void refreshInvites()
    },
    onError: (error) => setFormError(inviteError(error)),
  })
  const resend = useMutation({
    mutationFn: (inviteId: string) =>
      resendWorkspaceInvite(workspaceId, inviteId),
    onSuccess: () => toast.success('Invitation sent again'),
    onError: (error) => toast.error(inviteError(error)),
  })
  const revoke = useMutation({
    mutationFn: (inviteId: string) =>
      revokeWorkspaceInvite(workspaceId, inviteId),
    onSuccess: () => {
      toast.success('Invitation withdrawn')
      void refreshInvites()
    },
    onError: () => toast.error('Could not withdraw the invitation.'),
  })
  const remove = useMutation({
    mutationFn: (userId: string) => removeWorkspaceMember(workspaceId, userId),
    onSuccess: () => {
      toast.success('Member removed')
      void queryClient.invalidateQueries({
        queryKey: ['workspace-roster', workspaceId],
      })
    },
    onError: () => toast.error('Could not remove the member.'),
  })

  const rows = (roster.data ?? []).filter((member) =>
    `${member.fullName} ${member.email} ${member.role}`
      .toLowerCase()
      .includes(filter.trim().toLowerCase())
  )
  const mayRemove = (target: string, targetRole: string) =>
    target !== me &&
    targetRole !== 'owner' &&
    (isOwner || targetRole === 'member')

  return (
    <section className='space-y-6 rounded-md border border-border p-6'>
      <div className='flex flex-col justify-between gap-4 sm:flex-row sm:items-center'>
        <div>
          <h2 className='text-sm font-semibold'>Workspace members</h2>
          <p className='mt-1 text-xs text-muted-foreground'>
            People who can open this workspace, and invitations waiting for an
            answer.
          </p>
        </div>
        {canManage && (
          <Button
            variant='signal'
            size='sm'
            className='self-start sm:self-auto'
            onClick={() => {
              setFormError('')
              setInviteOpen(true)
            }}
          >
            Invite by email
          </Button>
        )}
      </div>

      <div className='space-y-2'>
        <Label htmlFor='member-filter' className='text-xs'>
          Filter members
        </Label>
        <Input
          id='member-filter'
          placeholder='Name, email or role'
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className='max-w-sm text-xs'
        />
      </div>

      {roster.isPending ? (
        <p role='status' className='text-xs text-muted-foreground'>
          Loading members…
        </p>
      ) : roster.isError ? (
        <div role='alert' className='space-y-2 text-xs'>
          <p>Could not load the members of this workspace.</p>
          <Button
            variant='outline'
            size='sm'
            onClick={() => void roster.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className='text-xs text-muted-foreground'>
          No member matches “{filter}”. Clear the filter to see everyone.
        </p>
      ) : (
        <ul className='divide-y divide-border border-y border-border'>
          {rows.map((member) => (
            <li
              key={member.userId}
              className='flex items-center justify-between gap-3 py-3'
            >
              <div className='min-w-0'>
                <p className='truncate text-[13px] font-medium'>
                  {member.fullName || member.email}
                </p>
                <p className='truncate font-mono text-xs text-muted-foreground'>
                  {member.email} · joined{' '}
                  {date.format(new Date(member.joinedAt))}
                </p>
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                <Badge variant='tag'>{member.role}</Badge>
                {canManage && mayRemove(member.userId, member.role) && (
                  <Button
                    variant='danger'
                    size='sm'
                    onClick={() =>
                      setRemoving({
                        id: member.userId,
                        name: member.fullName || member.email,
                      })
                    }
                  >
                    Remove
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className='space-y-2'>
          <h3 className='text-[13px] font-semibold'>Waiting for an answer</h3>
          {invites.isPending ? (
            <p role='status' className='text-xs text-muted-foreground'>
              Loading invitations…
            </p>
          ) : invites.isError ? (
            <div role='alert' className='space-y-2 text-xs'>
              <p>Could not load the invitations.</p>
              <Button
                variant='outline'
                size='sm'
                onClick={() => void invites.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : invites.data.length === 0 ? (
            <p className='text-xs text-muted-foreground'>
              No invitations are waiting. Invite someone by email to add them
              here.
            </p>
          ) : (
            <ul className='divide-y divide-border border-y border-border'>
              {invites.data.map((item) => (
                <li
                  key={item.id}
                  className='flex flex-wrap items-center justify-between gap-3 py-3'
                >
                  <div className='min-w-0'>
                    <p className='truncate text-[13px] font-medium'>
                      {item.email}
                    </p>
                    <p className='font-mono text-xs text-muted-foreground'>
                      expires {date.format(new Date(item.expiresAt))}
                    </p>
                  </div>
                  <div className='flex shrink-0 items-center gap-2'>
                    <Badge variant='tag'>{item.role}</Badge>
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={resend.isPending}
                      onClick={() => resend.mutate(item.id)}
                    >
                      Send again
                    </Button>
                    <Button
                      variant='danger'
                      size='sm'
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(item.id)}
                    >
                      Withdraw
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className='sm:max-w-[420px]'>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              setFormError('')
              invite.mutate()
            }}
            className='space-y-4'
          >
            <DialogHeader>
              <DialogTitle>Invite by email</DialogTitle>
              <DialogDescription>
                We email a link that works once for 7 days. The person must open
                it with this address.
              </DialogDescription>
            </DialogHeader>
            <div className='space-y-1.5'>
              <Label htmlFor='invite-email' className='text-xs'>
                Email address
              </Label>
              <Input
                id='invite-email'
                type='email'
                required
                autoFocus
                autoComplete='off'
                placeholder='name@company.com'
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className='text-xs'
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='invite-role' className='text-xs'>
                Role
              </Label>
              <Select
                value={inviteRole}
                onValueChange={(value) => setInviteRole(value as InviteRole)}
              >
                <SelectTrigger id='invite-role' className='text-xs'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='member' className='text-xs'>
                    Member, can read and edit documents
                  </SelectItem>
                  {isOwner && (
                    <SelectItem value='admin' className='text-xs'>
                      Admin, can also manage members
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            {formError && (
              <p role='alert' className='text-xs text-destructive'>
                {formError}
              </p>
            )}
            <DialogFooter className='gap-2 sm:gap-0'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => setInviteOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type='submit'
                variant='signal'
                size='sm'
                disabled={invite.isPending}
              >
                {invite.isPending ? 'Sending…' : 'Send invitation'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to this workspace right away. You can invite them
              again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep member</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removing && remove.mutate(removing.id)}
            >
              Remove member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
