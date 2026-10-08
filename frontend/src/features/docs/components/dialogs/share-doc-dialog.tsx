import { useState, useMemo } from 'react'
import type { DocumentAccessLevel, DocumentItem } from '@/types/dokudocs'
import { Copy, Lock, Mail, Share2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface ShareDocDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: DocumentItem
}

export function ShareDocDialog({
  open,
  onOpenChange,
  document: doc,
}: ShareDocDialogProps) {
  const documentAccessesMap = useDokudocsStore((s) => s.documentAccesses)
  const setDocumentAccess = useDokudocsStore((s) => s.setDocumentAccess)
  const removeDocumentAccess = useDokudocsStore((s) => s.removeDocumentAccess)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<DocumentAccessLevel>('view')

  const docAccesses = useMemo(() => {
    return documentAccessesMap[doc.id] || []
  }, [documentAccessesMap, doc.id])

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/docs/${doc.id}`
      : `/docs/${doc.id}`

  const handleCopyLink = () => {
    toast.info('Document sharing is not available yet')
  }

  const handleAddMember = () => {
    const trimmed = inviteEmail.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) {
      toast.error('Please enter a valid email address')
      return
    }

    setDocumentAccess(doc.id, trimmed, inviteRole)
    setInviteEmail('')
    toast.success(`Access granted to ${trimmed}`)
  }

  const handleRoleChange = (
    _accessId: string,
    email: string,
    role: DocumentAccessLevel
  ) => {
    setDocumentAccess(doc.id, email, role)
    toast.success(`Updated access for ${email}`)
  }

  const handleRemove = (accessId: string, email: string) => {
    removeDocumentAccess(doc.id, accessId)
    toast.success(`Removed access for ${email}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md p-6'>
        <DialogHeader>
          <div className='flex items-center gap-2'>
            <div className='flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary'>
              <Share2 className='size-4' />
            </div>
            <div>
              <DialogTitle className='text-base font-semibold text-foreground'>
                Share Document
              </DialogTitle>
              <DialogDescription className='text-xs text-muted-foreground'>
                Sharing is not available yet. This document is stored locally.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Link Sharing Section */}
        <div className='mt-2 space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3'>
          <div className='flex items-center justify-between text-xs'>
            <div className='flex items-center gap-1.5 font-medium text-foreground'>
              <Lock className='size-3.5 text-muted-foreground' />
              <span>Public sharing is not available yet</span>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <Input
              readOnly
              disabled
              value={shareUrl}
              className='h-8 font-mono text-[11px] text-muted-foreground'
            />
            <Button
              size='sm'
              variant='outline'
              onClick={handleCopyLink}
              disabled
              className='h-8 shrink-0 gap-1.5 px-3 text-xs'
            >
              <Copy className='size-3.5' />
              <span>Copy Link</span>
            </Button>
          </div>
        </div>

        {/* Invite Member Section */}
        <div className='mt-4 space-y-2'>
          <label className='text-xs font-semibold text-foreground'>
            Add collaborators
          </label>
          <div className='flex items-center gap-2'>
            <div className='relative flex-1'>
              <Mail className='absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground' />
              <Input
                type='email'
                disabled
                placeholder='colleague@company.com'
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddMember()
                }}
                className='h-8 ps-8 text-xs'
              />
            </div>
            <Select
              disabled
              value={inviteRole}
              onValueChange={(val) => setInviteRole(val as DocumentAccessLevel)}
            >
              <SelectTrigger className='h-8 w-28 text-xs'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='view' className='text-xs'>
                  Can view
                </SelectItem>
                <SelectItem value='comment' className='text-xs'>
                  Can comment
                </SelectItem>
                <SelectItem value='edit' className='text-xs'>
                  Can edit
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              size='sm'
              disabled
              onClick={handleAddMember}
              className='h-8 px-3 text-xs'
            >
              Invite
            </Button>
          </div>
        </div>

        {/* Access List Section */}
        <div className='mt-4 space-y-2'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-semibold text-foreground'>
              Local collaborator records
            </span>
            <span className='text-[10px] text-muted-foreground'>
              {docAccesses.length + 1} members
            </span>
          </div>

          <ScrollArea className='max-h-52 pe-1'>
            <div className='space-y-2'>
              {/* Document Author / Owner */}
              <div className='flex items-center justify-between rounded-lg border border-border/50 bg-card/60 p-2 text-xs'>
                <div className='flex items-center gap-2.5'>
                  <Avatar className='size-7'>
                    <AvatarImage
                      src={doc.author.avatar}
                      alt={doc.author.name}
                    />
                    <AvatarFallback className='text-[10px]'>
                      {doc.author.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className='flex flex-col'>
                    <span className='font-medium text-foreground'>
                      {doc.author.name} (You)
                    </span>
                    <span className='text-[10px] text-muted-foreground'>
                      {doc.author.email}
                    </span>
                  </div>
                </div>
                <span className='pe-2 text-[11px] font-medium text-muted-foreground'>
                  Owner
                </span>
              </div>

              {/* Granular Access Members */}
              {docAccesses.map((access) => (
                <div
                  key={access.id}
                  className='flex items-center justify-between rounded-lg border border-border/50 bg-card/60 p-2 text-xs'
                >
                  <div className='flex items-center gap-2.5'>
                    <Avatar className='size-7'>
                      <AvatarImage
                        src={access.user.avatar}
                        alt={access.user.name}
                      />
                      <AvatarFallback className='text-[10px]'>
                        {access.user.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className='flex flex-col'>
                      <span className='font-medium text-foreground'>
                        {access.user.name}
                      </span>
                      <span className='text-[10px] text-muted-foreground'>
                        {access.user.email}
                      </span>
                    </div>
                  </div>

                  <div className='flex items-center gap-1.5'>
                    <Select
                      disabled
                      value={access.accessLevel}
                      onValueChange={(val) =>
                        handleRoleChange(
                          access.id,
                          access.user.email,
                          val as DocumentAccessLevel
                        )
                      }
                    >
                      <SelectTrigger className='h-7 w-24 text-[11px]'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align='end'>
                        <SelectItem value='view' className='text-xs'>
                          Viewer
                        </SelectItem>
                        <SelectItem value='comment' className='text-xs'>
                          Commenter
                        </SelectItem>
                        <SelectItem value='edit' className='text-xs'>
                          Editor
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      variant='ghost'
                      size='icon'
                      className='size-7 text-muted-foreground hover:text-destructive'
                      onClick={() => handleRemove(access.id, access.user.email)}
                      title='Remove access'
                      disabled
                    >
                      <Trash2 className='size-3.5' />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
