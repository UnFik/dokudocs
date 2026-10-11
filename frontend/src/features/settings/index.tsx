import { useState } from 'react'
import { Separator } from '@radix-ui/react-select'
import { useQuery } from '@tanstack/react-query'
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
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { defaultOrganizations, useDokudocsStore } from '@/stores/dokudocs-store'
import { listWorkspaceRoster } from '@/lib/domain-api'
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
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useWorkspaces } from '@/features/workspaces/hooks/use-workspaces'
import { WorkspaceMembers } from './workspace-members'

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

  const { activeWorkspace } = useWorkspaces()
  const roster = useQuery({
    queryKey: ['workspace-roster', activeWorkspace?.id ?? ''],
    queryFn: ({ signal }) => listWorkspaceRoster(activeWorkspace!.id, signal),
    enabled: Boolean(activeWorkspace),
  })
  const memberCount = roster.data?.length

  const [activeTab, setActiveTab] = useState('general')
  const [workspaceName, setWorkspaceName] = useState(activeOrg?.name || '')
  const [copiedId, setCopiedId] = useState(false)

  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('')

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

  const handlePlanChange = (planName: string) => {
    updateOrganization(activeOrg.id, { plan: planName })
    toast.success(`Switched to ${planName} plan!`)
  }

  return (
    <div className='flex flex-1 flex-col gap-6 p-6'>
      <div className='flex flex-col justify-between gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center'>
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
            Manage your workspace profile, billing subscriptions, team members,
            and notifications.
          </p>
        </div>
      </div>

      <div className='space-y-6'>
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className='space-y-6'
        >
          <TabsList className='inline-flex h-auto gap-1 rounded-lg border border-border/40 bg-muted/60 p-1'>
            <TabsTrigger
              value='general'
              className='rounded-md px-3.5 py-1.5 text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground'
            >
              General
            </TabsTrigger>
            <TabsTrigger
              value='billing'
              className='rounded-md px-3.5 py-1.5 text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground'
            >
              Billing
            </TabsTrigger>
            <TabsTrigger
              value='members'
              className='rounded-md px-3.5 py-1.5 text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground'
            >
              Members
            </TabsTrigger>
            <TabsTrigger
              value='notifications'
              className='rounded-md px-3.5 py-1.5 text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground'
            >
              Notifications
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value='general'
            className='space-y-6 focus-visible:outline-none'
          >
            <div className='space-y-6 rounded-xl border border-border/70 bg-card/60 p-6'>
              <div className='flex items-start gap-3.5'>
                <div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground'>
                  <Building2 className='size-5 text-muted-foreground' />
                </div>
                <div>
                  <h2 className='text-base leading-none font-semibold text-foreground'>
                    Workspace Profile
                  </h2>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Update your workspace's basic information
                  </p>
                </div>
              </div>

              <Separator />

              <form onSubmit={handleSaveProfile} className='space-y-6'>
                <div className='flex items-center gap-4 pt-1'>
                  <div className='flex size-16 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-xl font-bold text-foreground'>
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
                      className='h-7 gap-1.5 text-xs'
                      onClick={() => toast.info('Logo upload ready')}
                    >
                      <Upload className='size-3' />
                      <span>Change Logo</span>
                    </Button>
                  </div>
                </div>

                <div className='space-y-1.5'>
                  <Label
                    htmlFor='workspace-name'
                    className='text-xs font-medium'
                  >
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
                      className='bg-muted/40 font-mono text-xs text-muted-foreground'
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
                        <Check className='size-4 text-ok' />
                      ) : (
                        <Copy className='size-4 text-muted-foreground' />
                      )}
                    </Button>
                  </div>
                  <p className='text-[11px] text-muted-foreground'>
                    Your unique workspace identifier
                  </p>
                </div>

                <Button type='submit' size='sm' className='px-4 text-xs'>
                  Save Changes
                </Button>
              </form>
            </div>

            <div className='space-y-5 rounded-lg border border-destructive/40 p-6'>
              <div className='flex items-start gap-3.5'>
                <div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-destructive'>
                  <AlertTriangle className='size-5' />
                </div>
                <div>
                  <h2 className='text-base leading-none font-semibold text-destructive'>
                    Danger Zone
                  </h2>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Irreversible actions that affect your workspace
                  </p>
                </div>
              </div>

              <div className='divide-y divide-border pt-2'>
                <div className='flex items-center justify-between py-3.5'>
                  <div className='space-y-0.5 pr-4'>
                    <p className='text-xs font-medium text-foreground'>
                      Leave Workspace
                    </p>
                    <p className='text-[11px] text-muted-foreground'>
                      Revoke your access to documents and resources in this
                      workspace.
                    </p>
                  </div>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => setLeaveDialogOpen(true)}
                    className='shrink-0 border-destructive/30 text-xs text-destructive hover:bg-destructive/10'
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
                    className='shrink-0 text-xs'
                  >
                    Delete Workspace
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent
            value='billing'
            className='space-y-6 focus-visible:outline-none'
          >
            <div className='space-y-6 rounded-xl border border-border/70 bg-card/60 p-6'>
              <div className='flex items-start justify-between'>
                <div className='flex items-start gap-3.5'>
                  <div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                    <Crown className='size-5' />
                  </div>
                  <div>
                    <div className='flex items-center gap-2'>
                      <h2 className='text-base leading-none font-semibold text-foreground'>
                        Current Subscription
                      </h2>
                      <Badge
                        variant='secondary'
                        className='text-[10px] font-semibold uppercase'
                      >
                        {activeOrg.plan || 'Free'}
                      </Badge>
                    </div>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      Manage your workspace billing tier and usage limits
                    </p>
                  </div>
                </div>
              </div>

              <div className='grid grid-cols-1 gap-4 pt-2 md:grid-cols-3'>
                <div
                  className={`flex flex-col justify-between rounded-xl border p-4 transition-all ${
                    activeOrg.plan === 'Free'
                      ? 'border-primary bg-primary/5'
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
                      $0{' '}
                      <span className='text-xs font-normal text-muted-foreground'>
                        /mo
                      </span>
                    </p>
                    <ul className='space-y-1.5 text-xs text-muted-foreground'>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 shrink-0 text-primary' />
                        <span>Up to 10 documents</span>
                      </li>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 shrink-0 text-primary' />
                        <span>1 Workspace member</span>
                      </li>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 shrink-0 text-primary' />
                        <span>Community Support</span>
                      </li>
                    </ul>
                  </div>
                  <Button
                    size='sm'
                    variant={activeOrg.plan === 'Free' ? 'outline' : 'default'}
                    disabled={activeOrg.plan === 'Free'}
                    onClick={() => handlePlanChange('Free')}
                    className='mt-4 w-full text-xs'
                  >
                    {activeOrg.plan === 'Free'
                      ? 'Current Plan'
                      : 'Downgrade to Free'}
                  </Button>
                </div>

                <div
                  className={`flex flex-col justify-between rounded-xl border p-4 transition-all ${
                    activeOrg.plan === 'Pro Workspace'
                      ? 'border-primary bg-primary/5'
                      : 'border-border/60 bg-muted/20 hover:border-border'
                  }`}
                >
                  <div className='space-y-3'>
                    <div className='flex items-center justify-between'>
                      <span className='text-sm font-semibold'>
                        Pro Workspace
                      </span>
                      {activeOrg.plan === 'Pro Workspace' && (
                        <Badge className='text-[10px]'>Active</Badge>
                      )}
                    </div>
                    <p className='text-2xl font-bold'>
                      $12{' '}
                      <span className='text-xs font-normal text-muted-foreground'>
                        /mo
                      </span>
                    </p>
                    <ul className='space-y-1.5 text-xs text-muted-foreground'>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 shrink-0 text-primary' />
                        <span>Unlimited documents & diagrams</span>
                      </li>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 shrink-0 text-primary' />
                        <span>Up to 10 team members</span>
                      </li>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 shrink-0 text-primary' />
                        <span>Export Markdown, PDF, Mermaid</span>
                      </li>
                    </ul>
                  </div>
                  <Button
                    size='sm'
                    variant={
                      activeOrg.plan === 'Pro Workspace' ? 'outline' : 'default'
                    }
                    disabled={activeOrg.plan === 'Pro Workspace'}
                    onClick={() => handlePlanChange('Pro Workspace')}
                    className='mt-4 w-full text-xs'
                  >
                    {activeOrg.plan === 'Pro Workspace'
                      ? 'Current Plan'
                      : 'Switch to Pro'}
                  </Button>
                </div>

                <div
                  className={`flex flex-col justify-between rounded-xl border p-4 transition-all ${
                    activeOrg.plan === 'Enterprise'
                      ? 'border-primary bg-primary/5'
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
                      $39{' '}
                      <span className='text-xs font-normal text-muted-foreground'>
                        /mo
                      </span>
                    </p>
                    <ul className='space-y-1.5 text-xs text-muted-foreground'>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 shrink-0 text-primary' />
                        <span>Unlimited everything</span>
                      </li>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 shrink-0 text-primary' />
                        <span>Audit logs & SAML SSO</span>
                      </li>
                      <li className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5 shrink-0 text-primary' />
                        <span>24/7 Dedicated Support</span>
                      </li>
                    </ul>
                  </div>
                  <Button
                    size='sm'
                    variant={
                      activeOrg.plan === 'Enterprise' ? 'outline' : 'default'
                    }
                    disabled={activeOrg.plan === 'Enterprise'}
                    onClick={() => handlePlanChange('Enterprise')}
                    className='mt-4 w-full text-xs'
                  >
                    {activeOrg.plan === 'Enterprise'
                      ? 'Current Plan'
                      : 'Switch to Enterprise'}
                  </Button>
                </div>
              </div>

              <div className='space-y-3 rounded-lg border border-border/50 bg-muted/30 p-4'>
                <h3 className='text-xs font-semibold text-foreground'>
                  Usage Summary
                </h3>
                <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
                  <div className='space-y-1'>
                    <p className='text-[11px] text-muted-foreground'>
                      Active Documents
                    </p>
                    <p className='text-base font-bold'>{activeDocCount} docs</p>
                  </div>
                  <div className='space-y-1'>
                    <p className='text-[11px] text-muted-foreground'>
                      Workspace Members
                    </p>
                    <p className='text-base font-bold'>
                      {memberCount ?? '–'} members
                    </p>
                  </div>
                  <div className='space-y-1'>
                    <p className='text-[11px] text-muted-foreground'>
                      Storage Used
                    </p>
                    <p className='text-base font-bold'>24.5 MB / 10 GB</p>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent
            value='members'
            className='space-y-6 focus-visible:outline-none'
          >
            <WorkspaceMembers />
          </TabsContent>

          <TabsContent
            value='notifications'
            className='space-y-6 focus-visible:outline-none'
          >
            <div className='space-y-6 rounded-xl border border-border/70 bg-card/60 p-6'>
              <div className='flex items-start gap-3.5'>
                <div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground'>
                  <Mail className='size-5 text-muted-foreground' />
                </div>
                <div>
                  <h2 className='text-base leading-none font-semibold text-foreground'>
                    Workspace Notifications
                  </h2>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Configure email and in-app alerts for workspace events
                  </p>
                </div>
              </div>

              <div className='divide-y divide-border/60'>
                <div className='flex items-center justify-between py-4'>
                  <div className='space-y-0.5 pr-4'>
                    <Label className='cursor-pointer text-xs font-medium text-foreground'>
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
                    <Label className='cursor-pointer text-xs font-medium text-foreground'>
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
                    <Label className='cursor-pointer text-xs font-medium text-foreground'>
                      @Mentions
                    </Label>
                    <p className='text-[11px] text-muted-foreground'>
                      Instant alert when someone tags you in a document or
                      comment.
                    </p>
                  </div>
                  <Switch
                    checked={notifyMentions}
                    onCheckedChange={setNotifyMentions}
                  />
                </div>

                <div className='flex items-center justify-between py-4'>
                  <div className='space-y-0.5 pr-4'>
                    <Label className='cursor-pointer text-xs font-medium text-foreground'>
                      Weekly Digest
                    </Label>
                    <p className='text-[11px] text-muted-foreground'>
                      A summary of top documents and changes emailed every
                      Monday.
                    </p>
                  </div>
                  <Switch
                    checked={notifyDigest}
                    onCheckedChange={setNotifyDigest}
                  />
                </div>

                <div className='flex items-center justify-between py-4'>
                  <div className='space-y-0.5 pr-4'>
                    <Label className='cursor-pointer text-xs font-medium text-foreground'>
                      Security Alerts
                    </Label>
                    <p className='text-[11px] text-muted-foreground'>
                      Important notices regarding workspace access and settings
                      changes.
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
              Are you sure you want to leave "{activeOrg.name}"? You will lose
              access to all documents within this workspace.
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
              This action cannot be undone. All documents and projects in this
              workspace will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-2 py-2'>
            <Label className='text-xs font-medium'>
              Type{' '}
              <span className='font-bold text-foreground select-all'>
                {activeOrg.name}
              </span>{' '}
              to confirm:
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
    </div>
  )
}
