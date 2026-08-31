import { useState } from 'react'
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Crown,
  Key,
  Mail,
  Settings as SettingsIcon,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { defaultOrganizations, useDokudocsStore } from '@/stores/dokudocs-store'
import { Separator } from '@radix-ui/react-select'

interface MemberItem {
  id: string
  name: string
  email: string
  avatar: string
  role: 'Owner' | 'Admin' | 'Member' | 'Viewer'
  joinedAt: string
}

const initialMembers: MemberItem[] = [
  {
    id: 'mem-1',
    name: 'Fikri',
    email: 'fikri@dokudocs.app',
    avatar: '/avatars/01.png',
    role: 'Owner',
    joinedAt: 'Jan 15, 2026',
  },
  {
    id: 'mem-2',
    name: 'Sarah Jenkins',
    email: 'sarah.j@dokudocs.app',
    avatar: '/avatars/02.png',
    role: 'Admin',
    joinedAt: 'Feb 02, 2026',
  },
  {
    id: 'mem-3',
    name: 'Alex Rivera',
    email: 'alex.r@dokudocs.app',
    avatar: '/avatars/03.png',
    role: 'Member',
    joinedAt: 'Mar 10, 2026',
  },
  {
    id: 'mem-4',
    name: 'Elena Rostova',
    email: 'elena.rostova@dokudocs.app',
    avatar: '/avatars/04.png',
    role: 'Viewer',
    joinedAt: 'Apr 01, 2026',
  },
]

export function Settings() {
  const storeOrganizations = useDokudocsStore((s) => s.organizations)
  const activeOrgId = useDokudocsStore((s) => s.activeOrgId)
  const updateOrganization = useDokudocsStore((s) => s.updateOrganization)
  const deleteOrganization = useDokudocsStore((s) => s.deleteOrganization)
  const documents = useDokudocsStore((s) => s.documents || [])

  const organizations = storeOrganizations?.length
    ? storeOrganizations
    : defaultOrganizations
  const activeOrg =
    organizations.find((org) => org.id === activeOrgId) || organizations[0]

  const [activeTab, setActiveTab] = useState('general')
  const [workspaceName, setWorkspaceName] = useState(activeOrg?.name || '')
  const [copiedId, setCopiedId] = useState(false)

  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('')

  const [members, setMembers] = useState<MemberItem[]>(initialMembers)
  const [memberSearch, setMemberSearch] = useState('')
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'Admin' | 'Member' | 'Viewer'>('Member')

  const [notifyDocUpdates, setNotifyDocUpdates] = useState(true)
  const [notifyComments, setNotifyComments] = useState(true)
  const [notifyMentions, setNotifyMentions] = useState(true)
  const [notifyDigest, setNotifyDigest] = useState(false)
  const [notifySecurity, setNotifySecurity] = useState(true)

  const activeDocCount = documents.filter(
    (d) => d.orgId === activeOrg.id && !d.deletedAt
  ).length

  const handleCopyId = () => {
    navigator.clipboard.writeText(activeOrg.id)
    setCopiedId(true)
    toast.success('Workspace ID copied to clipboard')
    setTimeout(() => setCopiedId(false), 2000)
  }

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = workspaceName.trim()
    if (!trimmed) {
      toast.error('Workspace name cannot be empty')
      return
    }

    updateOrganization(activeOrg.id, {
      name: trimmed,
    })
    toast.success('Workspace profile updated successfully')
  }

  const handleLeaveWorkspace = () => {
    if (organizations.length <= 1) {
      toast.error('Cannot leave your only workspace')
      setLeaveDialogOpen(false)
      return
    }
    deleteOrganization(activeOrg.id)
    toast.success(`Left workspace "${activeOrg.name}"`)
    setLeaveDialogOpen(false)
  }

  const handleDeleteWorkspace = () => {
    if (organizations.length <= 1) {
      toast.error('Cannot delete your only workspace')
      setDeleteDialogOpen(false)
      return
    }
    if (deleteConfirmationName !== activeOrg.name) {
      toast.error('Workspace name confirmation does not match')
      return
    }
    deleteOrganization(activeOrg.id)
    toast.success(`Workspace "${activeOrg.name}" permanently deleted`)
    setDeleteDialogOpen(false)
    setDeleteConfirmationName('')
  }

  const handleInviteMember = (e: React.FormEvent) => {
    e.preventDefault()
    const emailTrimmed = inviteEmail.trim()
    if (!emailTrimmed || !emailTrimmed.includes('@')) {
      toast.error('Please enter a valid email address')
      return
    }
    if (members.some((m) => m.email.toLowerCase() === emailTrimmed.toLowerCase())) {
      toast.error('User is already a member of this workspace')
      return
    }

    const newMember: MemberItem = {
      id: `mem-${Date.now()}`,
      name: emailTrimmed.split('@')[0],
      email: emailTrimmed,
      avatar: `/avatars/0${(members.length % 5) + 1}.png`,
      role: inviteRole,
      joinedAt: 'Just now',
    }

    setMembers([...members, newMember])
    setInviteEmail('')
    setInviteDialogOpen(false)
    toast.success(`Invitation sent to ${emailTrimmed}`)
  }

  const handleRemoveMember = (id: string, name: string) => {
    if (members.length <= 1) {
      toast.error('Workspace must have at least one member')
      return
    }
    setMembers(members.filter((m) => m.id !== id))
    toast.success(`Removed ${name} from workspace`)
  }

  const handleRoleChange = (id: string, newRole: MemberItem['role']) => {
    setMembers(
      members.map((m) => (m.id === id ? { ...m, role: newRole } : m))
    )
    toast.success('Member role updated')
  }

  const handlePlanChange = (planName: string) => {
    updateOrganization(activeOrg.id, { plan: planName })
    toast.success(`Switched to ${planName} plan!`)
  }

  const filteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
      m.email.toLowerCase().includes(memberSearch.toLowerCase()) ||
      m.role.toLowerCase().includes(memberSearch.toLowerCase())
  )

  return (
    <div className='flex flex-1 flex-col gap-6 p-6'>
      <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-5'>
        <div>
          <div className='flex items-center gap-2.5'>
            <div className='flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary'>
              <SettingsIcon className='size-4' />
            </div>
            <h1 className='text-xl font-bold tracking-tight text-foreground'>
              Settings
            </h1>
          </div>
          <p className='mt-1 text-xs text-muted-foreground'>
            Manage your workspace profile, billing subscriptions, team members, and notifications.
          </p>
        </div>
      </div>

      <div className='space-y-6'>
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className='space-y-6'
        >
          <TabsList className='h-auto p-1 bg-muted/60 rounded-lg inline-flex gap-1 border border-border/40'>
            <TabsTrigger
              value='general'
              className='rounded-md px-3.5 py-1.5 text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs'
            >
              General
            </TabsTrigger>
            <TabsTrigger
              value='billing'
              className='rounded-md px-3.5 py-1.5 text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs'
            >
              Billing
            </TabsTrigger>
            <TabsTrigger
              value='members'
              className='rounded-md px-3.5 py-1.5 text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs'
            >
              Members
            </TabsTrigger>
            <TabsTrigger
              value='notifications'
              className='rounded-md px-3.5 py-1.5 text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs'
            >
              Notifications
            </TabsTrigger>
          </TabsList>

          <TabsContent value='general' className='space-y-6 focus-visible:outline-none'>
            <div className='rounded-xl border border-border/70 bg-card/60 p-6 shadow-xs space-y-6'>
              <div className='flex items-start gap-3.5'>
                <div className='flex size-9 items-center justify-center rounded-lg bg-muted text-foreground shrink-0'>
                  <Building2 className='size-5 text-muted-foreground' />
                </div>
                <div>
                  <h2 className='text-base font-semibold text-foreground leading-none'>
                    Workspace Profile
                  </h2>
                  <p className='text-xs text-muted-foreground mt-1'>
                    Update your workspace's basic information
                  </p>
                </div>
              </div>

              <Separator />

              <form onSubmit={handleSaveProfile} className='space-y-6'>
                <div className='flex items-center gap-4 pt-1'>
                  <div className='flex size-16 items-center justify-center rounded-xl bg-muted border border-border text-foreground font-bold text-xl shrink-0'>
                    <Building2 className='size-7 text-muted-foreground' />
                  </div>
                  <div className='space-y-1.5'>
                    <p className='text-xs font-medium text-foreground'>
                      Workspace Logo
                    </p>
                    <p className='text-[11px] text-muted-foreground'>
                      Recommended: Square Image, max 5MB
                    </p>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      className='h-7 text-xs gap-1.5'
                      onClick={() => toast.info('Logo upload ready')}
                    >
                      <Upload className='size-3' />
                      <span>Change Logo</span>
                    </Button>
                  </div>
                </div>

                <div className='space-y-1.5'>
                  <Label htmlFor='workspace-name' className='text-xs font-medium'>
                    Workspace Name
                  </Label>
                  <Input
                    id='workspace-name'
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    className='max-w-xl text-xs'
                  />
                </div>

                <div className='space-y-1.5'>
                  <div className='flex items-center gap-1.5 text-xs font-medium text-muted-foreground'>
                    <Key className='size-3.5' />
                    <span>Workspace ID</span>
                  </div>
                  <div className='flex max-w-xl items-center gap-2'>
                    <Input
                      readOnly
                      value={activeOrg.id}
                      className='text-xs font-mono bg-muted/40 text-muted-foreground'
                    />
                    <Button
                      type='button'
                      variant='outline'
                      size='icon'
                      onClick={handleCopyId}
                      className='size-9 shrink-0'
                      title='Copy ID'
                    >
                      {copiedId ? (
                        <Check className='size-4 text-emerald-500' />
                      ) : (
                        <Copy className='size-4 text-muted-foreground' />
                      )}
                    </Button>
                  </div>
                  <p className='text-[11px] text-muted-foreground'>
                    Your unique workspace identifier
                  </p>
                </div>

                <Button type='submit' size='sm' className='text-xs px-4'>
                  Save Changes
                </Button>
              </form>
            </div>

            <div className='rounded-xl border border-red-500/30 bg-red-500/5 p-6 shadow-xs space-y-5'>
              <div className='flex items-start gap-3.5'>
                <div className='flex size-9 items-center justify-center rounded-lg bg-red-500/10 text-red-500 shrink-0'>
                  <AlertTriangle className='size-5' />
                </div>
                <div>
                  <h2 className='text-base font-semibold text-destructive leading-none'>
                    Danger Zone
                  </h2>
                  <p className='text-xs text-muted-foreground mt-1'>
                    Irreversible actions that affect your workspace
                  </p>
                </div>
              </div>

              <div className='divide-y divide-red-500/15 pt-2'>
                <div className='flex items-center justify-between py-3.5'>
                  <div className='space-y-0.5 pr-4'>
                    <p className='text-xs font-medium text-foreground'>
                      Leave Workspace
                    </p>
                    <p className='text-[11px] text-muted-foreground'>
                      Revoke your access to documents and resources in this workspace.
                    </p>
                  </div>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => setLeaveDialogOpen(true)}
                    className='text-xs text-destructive border-destructive/30 hover:bg-destructive/10 shrink-0'
                  >
                    Leave Workspace
                  </Button>
                </div>

                <div className='flex items-center justify-between py-3.5'>
                  <div className='space-y-0.5 pr-4'>
                    <p className='text-xs font-medium text-destructive'>
                      Delete Workspace
                    </p>
                    <p className='text-[11px] text-muted-foreground'>
                      Permanently delete this workspace and all its data.
                    </p>
                  </div>
                  <Button
                    type='button'
                    variant='destructive'
                    size='sm'
                    onClick={() => {
                      setDeleteConfirmationName('')
                      setDeleteDialogOpen(true)
                    }}
                    className='text-xs shrink-0'
                  >
                    Delete Workspace
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value='billing' className='space-y-6 focus-visible:outline-none'>
            <div className='rounded-xl border border-border/70 bg-card/60 p-6 shadow-xs space-y-6'>
              <div className='flex items-start justify-between'>
                <div className='flex items-start gap-3.5'>
                  <div className='flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0'>
                    <Crown className='size-5' />
                  </div>
                  <div>
                    <div className='flex items-center gap-2'>
                      <h2 className='text-base font-semibold text-foreground leading-none'>
                        Current Subscription
                      </h2>
                      <Badge variant='secondary' className='text-[10px] font-semibold uppercase'>
                        {activeOrg.plan || 'Free'}
                      </Badge>
                    </div>
                    <p className='text-xs text-muted-foreground mt-1'>
                      Manage your workspace billing tier and usage limits
                    </p>
                  </div>
                </div>
              </div>

              <div className='grid grid-cols-1 md:grid-cols-3 gap-4 pt-2'>
                <div
                  className={`rounded-xl p-4 border flex flex-col justify-between transition-all ${
                    activeOrg.plan === 'Free'
                      ? 'border-primary bg-primary/5 shadow-xs'
                      : 'border-border/60 bg-muted/20 hover:border-border'
                  }`}
                >
                  <div className='space-y-3'>
                    <div className='flex items-center justify-between'>
                      <span className='text-sm font-semibold'>Free</span>
                      {activeOrg.plan === 'Free' && (
                        <Badge className='text-[10px]'>Active</Badge>
                      )}
                    </div>
                    <p className='text-2xl font-bold'>
                      $0 <span className='text-xs font-normal text-muted-foreground'>/mo</span>
                    </p>
                    <ul className='space-y-1.5 text-xs text-muted-foreground'>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 text-primary shrink-0' />
                        <span>Up to 10 documents</span>
                      </li>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 text-primary shrink-0' />
                        <span>1 Workspace member</span>
                      </li>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 text-primary shrink-0' />
                        <span>Community Support</span>
                      </li>
                    </ul>
                  </div>
                  <Button
                    size='sm'
                    variant={activeOrg.plan === 'Free' ? 'outline' : 'default'}
                    disabled={activeOrg.plan === 'Free'}
                    onClick={() => handlePlanChange('Free')}
                    className='w-full mt-4 text-xs'
                  >
                    {activeOrg.plan === 'Free' ? 'Current Plan' : 'Downgrade to Free'}
                  </Button>
                </div>

                <div
                  className={`rounded-xl p-4 border flex flex-col justify-between transition-all ${
                    activeOrg.plan === 'Pro Workspace'
                      ? 'border-primary bg-primary/5 shadow-xs'
                      : 'border-border/60 bg-muted/20 hover:border-border'
                  }`}
                >
                  <div className='space-y-3'>
                    <div className='flex items-center justify-between'>
                      <span className='text-sm font-semibold'>Pro Workspace</span>
                      {activeOrg.plan === 'Pro Workspace' && (
                        <Badge className='text-[10px]'>Active</Badge>
                      )}
                    </div>
                    <p className='text-2xl font-bold'>
                      $12 <span className='text-xs font-normal text-muted-foreground'>/mo</span>
                    </p>
                    <ul className='space-y-1.5 text-xs text-muted-foreground'>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 text-primary shrink-0' />
                        <span>Unlimited documents & diagrams</span>
                      </li>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 text-primary shrink-0' />
                        <span>Up to 10 team members</span>
                      </li>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 text-primary shrink-0' />
                        <span>Export Markdown, PDF, Mermaid</span>
                      </li>
                    </ul>
                  </div>
                  <Button
                    size='sm'
                    variant={activeOrg.plan === 'Pro Workspace' ? 'outline' : 'default'}
                    disabled={activeOrg.plan === 'Pro Workspace'}
                    onClick={() => handlePlanChange('Pro Workspace')}
                    className='w-full mt-4 text-xs'
                  >
                    {activeOrg.plan === 'Pro Workspace' ? 'Current Plan' : 'Switch to Pro'}
                  </Button>
                </div>

                <div
                  className={`rounded-xl p-4 border flex flex-col justify-between transition-all ${
                    activeOrg.plan === 'Enterprise'
                      ? 'border-primary bg-primary/5 shadow-xs'
                      : 'border-border/60 bg-muted/20 hover:border-border'
                  }`}
                >
                  <div className='space-y-3'>
                    <div className='flex items-center justify-between'>
                      <span className='text-sm font-semibold'>Enterprise</span>
                      {activeOrg.plan === 'Enterprise' && (
                        <Badge className='text-[10px]'>Active</Badge>
                      )}
                    </div>
                    <p className='text-2xl font-bold'>
                      $39 <span className='text-xs font-normal text-muted-foreground'>/mo</span>
                    </p>
                    <ul className='space-y-1.5 text-xs text-muted-foreground'>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 text-primary shrink-0' />
                        <span>Unlimited everything</span>
                      </li>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 text-primary shrink-0' />
                        <span>Audit logs & SAML SSO</span>
                      </li>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 text-primary shrink-0' />
                        <span>24/7 Dedicated Support</span>
                      </li>
                    </ul>
                  </div>
                  <Button
                    size='sm'
                    variant={activeOrg.plan === 'Enterprise' ? 'outline' : 'default'}
                    disabled={activeOrg.plan === 'Enterprise'}
                    onClick={() => handlePlanChange('Enterprise')}
                    className='w-full mt-4 text-xs'
                  >
                    {activeOrg.plan === 'Enterprise' ? 'Current Plan' : 'Switch to Enterprise'}
                  </Button>
                </div>
              </div>

              <div className='rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3'>
                <h3 className='text-xs font-semibold text-foreground'>
                  Usage Summary
                </h3>
                <div className='grid grid-cols-1 sm:grid-cols-3 gap-4'>
                  <div className='space-y-1'>
                    <p className='text-[11px] text-muted-foreground'>Active Documents</p>
                    <p className='text-base font-bold'>{activeDocCount} docs</p>
                  </div>
                  <div className='space-y-1'>
                    <p className='text-[11px] text-muted-foreground'>Workspace Members</p>
                    <p className='text-base font-bold'>{members.length} members</p>
                  </div>
                  <div className='space-y-1'>
                    <p className='text-[11px] text-muted-foreground'>Storage Used</p>
                    <p className='text-base font-bold'>24.5 MB / 10 GB</p>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value='members' className='space-y-6 focus-visible:outline-none'>
            <div className='rounded-xl border border-border/70 bg-card/60 p-6 shadow-xs space-y-6'>
              <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-4'>
                <div className='flex items-start gap-3.5'>
                  <div className='flex size-9 items-center justify-center rounded-lg bg-muted text-foreground shrink-0'>
                    <Users className='size-5 text-muted-foreground' />
                  </div>
                  <div>
                    <h2 className='text-base font-semibold text-foreground leading-none'>
                      Workspace Members
                    </h2>
                    <p className='text-xs text-muted-foreground mt-1'>
                      Manage team access, permissions, and invitations
                    </p>
                  </div>
                </div>
                <Button
                  size='sm'
                  onClick={() => setInviteDialogOpen(true)}
                  className='text-xs gap-1.5 self-start sm:self-auto'
                >
                  <UserPlus className='size-3.5' />
                  <span>Invite Member</span>
                </Button>
              </div>

              <div className='flex items-center gap-2'>
                <Input
                  placeholder='Filter members by name, email, or role...'
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  className='max-w-sm text-xs'
                />
              </div>

              <div className='rounded-lg border border-border/60 overflow-hidden'>
                <Table>
                  <TableHeader>
                    <TableRow className='hover:bg-transparent bg-muted/40'>
                      <TableHead className='text-xs font-semibold text-foreground'>User</TableHead>
                      <TableHead className='text-xs font-semibold text-foreground'>Role</TableHead>
                      <TableHead className='text-xs font-semibold text-foreground hidden sm:table-cell'>Joined</TableHead>
                      <TableHead className='text-xs font-semibold text-foreground text-end'>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMembers.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell className='py-3'>
                          <div className='flex items-center gap-3'>
                            <Avatar className='h-8 w-8 rounded-lg'>
                              <AvatarImage src={member.avatar} alt={member.name} />
                              <AvatarFallback className='rounded-lg text-xs'>
                                {member.name.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className='grid text-start leading-tight'>
                              <span className='text-xs font-medium text-foreground truncate'>
                                {member.name}
                              </span>
                              <span className='text-[11px] text-muted-foreground truncate'>
                                {member.email}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className='py-3'>
                          <Select
                            value={member.role}
                            disabled={member.role === 'Owner'}
                            onValueChange={(val) => handleRoleChange(member.id, val as MemberItem['role'])}
                          >
                            <SelectTrigger className='h-7 w-28 text-[11px]'>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value='Owner' disabled className='text-xs'>Owner</SelectItem>
                              <SelectItem value='Admin' className='text-xs'>Admin</SelectItem>
                              <SelectItem value='Member' className='text-xs'>Member</SelectItem>
                              <SelectItem value='Viewer' className='text-xs'>Viewer</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className='py-3 text-xs text-muted-foreground hidden sm:table-cell'>
                          {member.joinedAt}
                        </TableCell>
                        <TableCell className='py-3 text-end'>
                          {member.role !== 'Owner' && (
                            <Button
                              variant='ghost'
                              size='icon'
                              onClick={() => handleRemoveMember(member.id, member.name)}
                              className='size-7 text-muted-foreground hover:text-destructive'
                              title='Remove Member'
                            >
                              <Trash2 className='size-3.5' />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value='notifications' className='space-y-6 focus-visible:outline-none'>
            <div className='rounded-xl border border-border/70 bg-card/60 p-6 shadow-xs space-y-6'>
              <div className='flex items-start gap-3.5'>
                <div className='flex size-9 items-center justify-center rounded-lg bg-muted text-foreground shrink-0'>
                  <Mail className='size-5 text-muted-foreground' />
                </div>
                <div>
                  <h2 className='text-base font-semibold text-foreground leading-none'>
                    Workspace Notifications
                  </h2>
                  <p className='text-xs text-muted-foreground mt-1'>
                    Configure email and in-app alerts for workspace events
                  </p>
                </div>
              </div>

              <div className='divide-y divide-border/60'>
                <div className='flex items-center justify-between py-4'>
                  <div className='space-y-0.5 pr-4'>
                    <Label className='text-xs font-medium text-foreground cursor-pointer'>
                      Document Updates
                    </Label>
                    <p className='text-[11px] text-muted-foreground'>
                      Get notified whenever a document is edited or published.
                    </p>
                  </div>
                  <Switch
                    checked={notifyDocUpdates}
                    onCheckedChange={setNotifyDocUpdates}
                  />
                </div>

                <div className='flex items-center justify-between py-4'>
                  <div className='space-y-0.5 pr-4'>
                    <Label className='text-xs font-medium text-foreground cursor-pointer'>
                      Comments & Replies
                    </Label>
                    <p className='text-[11px] text-muted-foreground'>
                      Receive alerts for thread replies on your documents.
                    </p>
                  </div>
                  <Switch
                    checked={notifyComments}
                    onCheckedChange={setNotifyComments}
                  />
                </div>

                <div className='flex items-center justify-between py-4'>
                  <div className='space-y-0.5 pr-4'>
                    <Label className='text-xs font-medium text-foreground cursor-pointer'>
                      @Mentions
                    </Label>
                    <p className='text-[11px] text-muted-foreground'>
                      Instant alert when someone tags you in a document or comment.
                    </p>
                  </div>
                  <Switch
                    checked={notifyMentions}
                    onCheckedChange={setNotifyMentions}
                  />
                </div>

                <div className='flex items-center justify-between py-4'>
                  <div className='space-y-0.5 pr-4'>
                    <Label className='text-xs font-medium text-foreground cursor-pointer'>
                      Weekly Digest
                    </Label>
                    <p className='text-[11px] text-muted-foreground'>
                      A summary of top documents and changes emailed every Monday.
                    </p>
                  </div>
                  <Switch
                    checked={notifyDigest}
                    onCheckedChange={setNotifyDigest}
                  />
                </div>

                <div className='flex items-center justify-between py-4'>
                  <div className='space-y-0.5 pr-4'>
                    <Label className='text-xs font-medium text-foreground cursor-pointer'>
                      Security Alerts
                    </Label>
                    <p className='text-[11px] text-muted-foreground'>
                      Important notices regarding workspace access and settings changes.
                    </p>
                  </div>
                  <Switch
                    checked={notifySecurity}
                    onCheckedChange={setNotifySecurity}
                  />
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
        <DialogContent className='sm:max-w-[420px]'>
          <DialogHeader>
            <DialogTitle className='text-base font-semibold'>
              Leave Workspace
            </DialogTitle>
            <DialogDescription className='text-xs text-muted-foreground'>
              Are you sure you want to leave "{activeOrg.name}"? You will lose access to all documents within this workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className='gap-2 sm:gap-0'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setLeaveDialogOpen(false)}
              className='text-xs'
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              size='sm'
              onClick={handleLeaveWorkspace}
              className='text-xs'
            >
              Leave Workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className='sm:max-w-[420px]'>
          <DialogHeader>
            <DialogTitle className='text-base font-semibold text-destructive'>
              Delete Workspace
            </DialogTitle>
            <DialogDescription className='text-xs text-muted-foreground'>
              This action cannot be undone. All documents and projects in this workspace will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-2 py-2'>
            <Label className='text-xs font-medium'>
              Type <span className='font-bold select-all text-foreground'>{activeOrg.name}</span> to confirm:
            </Label>
            <Input
              value={deleteConfirmationName}
              onChange={(e) => setDeleteConfirmationName(e.target.value)}
              placeholder={activeOrg.name}
              className='text-xs'
            />
          </div>
          <DialogFooter className='gap-2 sm:gap-0'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setDeleteDialogOpen(false)}
              className='text-xs'
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              size='sm'
              disabled={deleteConfirmationName !== activeOrg.name}
              onClick={handleDeleteWorkspace}
              className='text-xs'
            >
              Delete Workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className='sm:max-w-[420px]'>
          <form onSubmit={handleInviteMember}>
            <DialogHeader>
              <div className='flex items-center gap-2.5'>
                <div className='flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                  <UserPlus className='size-5' />
                </div>
                <div>
                  <DialogTitle className='text-base font-semibold'>
                    Invite Team Member
                  </DialogTitle>
                  <DialogDescription className='text-xs text-muted-foreground'>
                    Invite someone to collaborate in {activeOrg.name}.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className='space-y-4 py-4'>
              <div className='space-y-1.5'>
                <Label htmlFor='invite-email' className='text-xs font-medium'>
                  Email Address
                </Label>
                <Input
                  id='invite-email'
                  type='email'
                  placeholder='colleague@company.com'
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  autoFocus
                  className='text-xs'
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='invite-role' className='text-xs font-medium'>
                  Role & Permissions
                </Label>
                <Select
                  value={inviteRole}
                  onValueChange={(v) => setInviteRole(v as typeof inviteRole)}
                >
                  <SelectTrigger id='invite-role' className='text-xs'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='Admin' className='text-xs'>Admin (Full management)</SelectItem>
                    <SelectItem value='Member' className='text-xs'>Member (Can edit documents)</SelectItem>
                    <SelectItem value='Viewer' className='text-xs'>Viewer (Read-only access)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className='gap-2 sm:gap-0'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => setInviteDialogOpen(false)}
                className='text-xs'
              >
                Cancel
              </Button>
              <Button type='submit' size='sm' className='text-xs'>
                Send Invitation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
