import { useState, useMemo } from 'react'
import {
  Mail,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import type { ProjectItem, ProjectMemberRole } from '@/types/dokudocs'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface ProjectMembersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: ProjectItem
}

export function ProjectMembersDialog({
  open,
  onOpenChange,
  project,
}: ProjectMembersDialogProps) {
  const projectMembersMap = useDokudocsStore((s) => s.projectMembers)
  const setProjectMember = useDokudocsStore((s) => s.setProjectMember)
  const removeProjectMember = useDokudocsStore((s) => s.removeProjectMember)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<ProjectMemberRole>('editor')

  const members = useMemo(() => {
    return projectMembersMap[project.id] || []
  }, [projectMembersMap, project.id])

  const handleAddMember = () => {
    const trimmed = inviteEmail.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) {
      toast.error('Please enter a valid email address')
      return
    }

    setProjectMember(project.id, trimmed, inviteRole)
    setInviteEmail('')
    toast.success(`Added ${trimmed} as ${inviteRole}`)
  }

  const handleRoleChange = (_memberId: string, email: string, role: ProjectMemberRole) => {
    setProjectMember(project.id, email, role)
    toast.success(`Updated role for ${email} to ${role}`)
  }

  const handleRemove = (memberId: string, email: string) => {
    removeProjectMember(project.id, memberId)
    toast.success(`Removed ${email} from project`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md p-6'>
        <DialogHeader>
          <div className='flex items-center gap-2'>
            <div className='flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary'>
              <Users className='size-4' />
            </div>
            <div>
              <DialogTitle className='text-base font-semibold text-foreground'>
                Project Members
              </DialogTitle>
              <DialogDescription className='text-xs text-muted-foreground'>
                Manage collaborators and roles for &ldquo;{project.name}&rdquo;
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Add Member Form */}
        <div className='mt-2 space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3'>
          <label className='flex items-center gap-1.5 text-xs font-semibold text-foreground'>
            <UserPlus className='size-3.5 text-primary' />
            <span>Add team member</span>
          </label>
          <div className='flex items-center gap-2'>
            <div className='relative flex-1'>
              <Mail className='absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground' />
              <Input
                type='email'
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
              value={inviteRole}
              onValueChange={(val) => setInviteRole(val as ProjectMemberRole)}
            >
              <SelectTrigger className='h-8 w-28 text-xs'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='viewer' className='text-xs'>Viewer</SelectItem>
                <SelectItem value='editor' className='text-xs'>Editor</SelectItem>
                <SelectItem value='manager' className='text-xs'>Manager</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size='sm'
              onClick={handleAddMember}
              className='h-8 px-3 text-xs'
            >
              Add
            </Button>
          </div>
        </div>

        {/* Members List */}
        <div className='mt-4 space-y-2'>
          <div className='flex items-center justify-between'>
            <span className='text-xs font-semibold text-foreground'>
              Current members
            </span>
            <span className='text-[10px] text-muted-foreground'>
              {members.length} members
            </span>
          </div>

          <ScrollArea className='max-h-56 pe-1'>
            {members.length === 0 ? (
              <div className='py-6 text-center text-xs text-muted-foreground'>
                No specific project members assigned. All workspace members inherit default access.
              </div>
            ) : (
              <div className='space-y-2'>
                {members.map((member) => (
                  <div
                    key={member.id}
                    className='flex items-center justify-between rounded-lg border border-border/50 bg-card/60 p-2 text-xs'
                  >
                    <div className='flex items-center gap-2.5'>
                      <Avatar className='size-7'>
                        <AvatarImage src={member.user.avatar} alt={member.user.name} />
                        <AvatarFallback className='text-[10px]'>
                          {member.user.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className='flex flex-col'>
                        <span className='font-medium text-foreground'>
                          {member.user.name}
                        </span>
                        <span className='text-[10px] text-muted-foreground'>
                          {member.user.email}
                        </span>
                      </div>
                    </div>

                    <div className='flex items-center gap-1.5'>
                      <Select
                        value={member.role}
                        onValueChange={(val) =>
                          handleRoleChange(member.id, member.user.email, val as ProjectMemberRole)
                        }
                      >
                        <SelectTrigger className='h-7 w-24 text-[11px]'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align='end'>
                          <SelectItem value='viewer' className='text-xs'>Viewer</SelectItem>
                          <SelectItem value='editor' className='text-xs'>Editor</SelectItem>
                          <SelectItem value='manager' className='text-xs'>Manager</SelectItem>
                        </SelectContent>
                      </Select>

                      <Button
                        variant='ghost'
                        size='icon'
                        className='size-7 text-muted-foreground hover:text-destructive'
                        onClick={() => handleRemove(member.id, member.user.email)}
                        title='Remove member'
                      >
                        <Trash2 className='size-3.5' />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
