import { useState } from 'react'
import {
  Bell,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  Key,
  Lock,
  Mail,
  Server,
  Shield,
  Sparkles,
  User,
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: {
    name: string
    email: string
    avatar: string
  }
}

const predefinedRoles = [
  'Web Developer',
  'Frontend Engineer',
  'Backend Engineer',
  'Fullstack Developer',
  'Solutions Architect',
  'Tech Lead',
  'Product Manager',
  'UI/UX Designer',
]

export function SettingsDialog({
  open,
  onOpenChange,
  user,
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<'account' | 'notification' | 'security'>('account')

  const [displayName, setDisplayName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [role, setRole] = useState('Web Developer')

  const [editNameOpen, setEditNameOpen] = useState(false)
  const [tempName, setTempName] = useState(user.name)

  const [editEmailOpen, setEditEmailOpen] = useState(false)
  const [tempEmail, setTempEmail] = useState(user.email)

  const [editRoleOpen, setEditRoleOpen] = useState(false)
  const [tempRole, setTempRole] = useState('Web Developer')

  const [emailNotifications, setEmailNotifications] = useState(true)
  const [docActivityAlerts, setDocActivityAlerts] = useState(true)
  const [commentsMentions, setCommentsMentions] = useState(true)
  const [marketingDigest, setMarketingDigest] = useState(false)

  const [mcpEnabled, setMcpEnabled] = useState(true)
  const [mcpServerUrl, setMcpServerUrl] = useState('http://localhost:3000/sse')
  const [mcpApiKey, setMcpApiKey] = useState('mcp_sk_live_9f823a01bc89421')
  const [showApiKey, setShowApiKey] = useState(false)
  const [allowDocRead, setAllowDocRead] = useState(true)
  const [allowDiagramGen, setAllowDiagramGen] = useState(true)
  const [allowSearchIndex, setAllowSearchIndex] = useState(true)
  const [twoFactorAuth, setTwoFactorAuth] = useState(false)

  const handleSaveName = () => {
    if (!tempName.trim()) {
      toast.error('Name cannot be empty')
      return
    }
    setDisplayName(tempName.trim())
    toast.success('Name updated successfully')
    setEditNameOpen(false)
  }

  const handleSaveEmail = () => {
    if (!tempEmail.trim() || !tempEmail.includes('@')) {
      toast.error('Please enter a valid email address')
      return
    }
    setEmail(tempEmail.trim())
    toast.success('Email updated. Verification sent.')
    setEditEmailOpen(false)
  }

  const handleSaveRole = () => {
    if (!tempRole.trim()) {
      toast.error('Role cannot be empty')
      return
    }
    setRole(tempRole.trim())
    toast.success('Role updated successfully')
    setEditRoleOpen(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='sm:max-w-2xl h-[540px] flex flex-col p-0 overflow-hidden'>
          <DialogTitle className='sr-only'>Settings</DialogTitle>
          <DialogDescription className='sr-only'>
            Manage account settings, notifications, and security & MCP integration.
          </DialogDescription>

          <div className='flex items-center gap-1.5 px-6 pt-5 pb-1 shrink-0'>
            <Button
              type='button'
              variant={activeTab === 'account' ? 'secondary' : 'ghost'}
              size='sm'
              onClick={() => setActiveTab('account')}
              className={`h-8 rounded-full px-3.5 text-xs font-medium transition-all ${
                activeTab === 'account'
                  ? 'bg-secondary text-secondary-foreground shadow-2xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <User className='mr-1.5 size-3.5' />
              Account
            </Button>

            <Button
              type='button'
              variant={activeTab === 'notification' ? 'secondary' : 'ghost'}
              size='sm'
              onClick={() => setActiveTab('notification')}
              className={`h-8 rounded-full px-3.5 text-xs font-medium transition-all ${
                activeTab === 'notification'
                  ? 'bg-secondary text-secondary-foreground shadow-2xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Bell className='mr-1.5 size-3.5' />
              Notifications
            </Button>

            <Button
              type='button'
              variant={activeTab === 'security' ? 'secondary' : 'ghost'}
              size='sm'
              onClick={() => setActiveTab('security')}
              className={`h-8 rounded-full px-3.5 text-xs font-medium transition-all ${
                activeTab === 'security'
                  ? 'bg-secondary text-secondary-foreground shadow-2xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Shield className='mr-1.5 size-3.5' />
              Security & MCP
            </Button>
          </div>

          <ScrollArea className='flex-1 min-h-0 px-6 py-4'>
            {activeTab === 'account' && (
              <div className='space-y-4 py-1'>
                <div className='flex items-center gap-4 rounded-xl border border-border/80 bg-card p-4'>
                  <Avatar className='size-14 rounded-xl border border-border/80 shadow-2xs'>
                    <AvatarImage src={user.avatar} alt={displayName} />
                    <AvatarFallback className='rounded-xl font-bold'>
                      {displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className='space-y-1 min-w-0 flex-1'>
                    <div className='flex items-center gap-2'>
                      <h4 className='font-semibold text-sm text-foreground truncate'>
                        {displayName}
                      </h4>
                      <Badge variant='secondary' className='text-[10px] px-1.5 py-0'>
                        {role}
                      </Badge>
                    </div>
                    <p className='text-xs text-muted-foreground truncate'>
                      {email}
                    </p>
                  </div>
                </div>

                <div className='rounded-xl border border-border/80 bg-card divide-y divide-border/60'>
                  <div className='flex items-center justify-between p-4'>
                    <div className='space-y-0.5'>
                      <p className='text-xs font-semibold text-muted-foreground'>Name</p>
                      <p className='text-sm font-medium text-foreground'>{displayName}</p>
                    </div>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() => {
                        setTempName(displayName)
                        setEditNameOpen(true)
                      }}
                      className='h-7 text-xs px-3'
                    >
                      Change name
                    </Button>
                  </div>

                  <div className='flex items-center justify-between p-4'>
                    <div className='space-y-0.5'>
                      <p className='text-xs font-semibold text-muted-foreground'>Email</p>
                      <p className='text-sm font-medium text-foreground'>{email}</p>
                      <p className='text-[11px] text-muted-foreground/80'>
                        Managed by Google OAuth
                      </p>
                    </div>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() => {
                        setTempEmail(email)
                        setEditEmailOpen(true)
                      }}
                      className='h-7 text-xs px-3'
                    >
                      Change email
                    </Button>
                  </div>

                  <div className='flex items-center justify-between p-4'>
                    <div className='space-y-0.5'>
                      <p className='text-xs font-semibold text-muted-foreground'>Role</p>
                      <p className='text-sm font-medium text-foreground'>{role}</p>
                    </div>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() => {
                        setTempRole(role)
                        setEditRoleOpen(true)
                      }}
                      className='h-7 text-xs px-3'
                    >
                      Change role
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'notification' && (
              <div className='space-y-4 py-1'>
                <div className='rounded-xl border border-border/80 bg-card divide-y divide-border/60'>
                  <div className='flex items-center justify-between p-4'>
                    <div className='space-y-0.5 pr-4'>
                      <div className='flex items-center gap-2'>
                        <Mail className='size-3.5 text-primary' />
                        <Label className='text-xs font-semibold cursor-pointer'>
                          Email Activity Digest
                        </Label>
                      </div>
                      <p className='text-[11px] text-muted-foreground'>
                        Receive periodic summary of changes and updates on your documents.
                      </p>
                    </div>
                    <Switch
                      checked={emailNotifications}
                      onCheckedChange={setEmailNotifications}
                    />
                  </div>

                  <div className='flex items-center justify-between p-4'>
                    <div className='space-y-0.5 pr-4'>
                      <div className='flex items-center gap-2'>
                        <Bell className='size-3.5 text-primary' />
                        <Label className='text-xs font-semibold cursor-pointer'>
                          Document Changes & Edits
                        </Label>
                      </div>
                      <p className='text-[11px] text-muted-foreground'>
                        Get notified when team members edit or publish shared documents.
                      </p>
                    </div>
                    <Switch
                      checked={docActivityAlerts}
                      onCheckedChange={setDocActivityAlerts}
                    />
                  </div>

                  <div className='flex items-center justify-between p-4'>
                    <div className='space-y-0.5 pr-4'>
                      <div className='flex items-center gap-2'>
                        <Sparkles className='size-3.5 text-primary' />
                        <Label className='text-xs font-semibold cursor-pointer'>
                          Comments & Mentions
                        </Label>
                      </div>
                      <p className='text-[11px] text-muted-foreground'>
                        Immediate alerts when you are tagged in document discussions.
                      </p>
                    </div>
                    <Switch
                      checked={commentsMentions}
                      onCheckedChange={setCommentsMentions}
                    />
                  </div>

                  <div className='flex items-center justify-between p-4'>
                    <div className='space-y-0.5 pr-4'>
                      <div className='flex items-center gap-2'>
                        <Globe className='size-3.5 text-primary' />
                        <Label className='text-xs font-semibold cursor-pointer'>
                          Product Updates & Releases
                        </Label>
                      </div>
                      <p className='text-[11px] text-muted-foreground'>
                        Stay up to date with new features, architecture tools, and plugins.
                      </p>
                    </div>
                    <Switch
                      checked={marketingDigest}
                      onCheckedChange={setMarketingDigest}
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'security' && (
              <div className='space-y-5 py-1'>
                <div className='rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3'>
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-2'>
                      <div className='flex size-7 items-center justify-center rounded-lg bg-primary/20 text-primary'>
                        <Cpu className='size-4' />
                      </div>
                      <div>
                        <h4 className='text-xs font-bold text-foreground'>
                          Model Context Protocol (MCP) Integration
                        </h4>
                        <p className='text-[11px] text-muted-foreground'>
                          Enable local/remote AI coding agents to inspect architecture and generate diagrams.
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={mcpEnabled}
                      onCheckedChange={setMcpEnabled}
                    />
                  </div>

                  {mcpEnabled && (
                    <div className='space-y-3 pt-2 border-t border-border/50'>
                      <div className='space-y-1.5'>
                        <Label htmlFor='mcpUrl' className='text-xs font-medium flex items-center gap-1.5'>
                          <Server className='size-3 text-muted-foreground' />
                          MCP Server Endpoint (SSE / HTTP)
                        </Label>
                        <Input
                          id='mcpUrl'
                          value={mcpServerUrl}
                          onChange={(e) => setMcpServerUrl(e.target.value)}
                          placeholder='http://localhost:3000/sse'
                          className='h-8 text-xs font-mono'
                        />
                      </div>

                      <div className='space-y-1.5'>
                        <Label htmlFor='mcpKey' className='text-xs font-medium flex items-center gap-1.5'>
                          <Key className='size-3 text-muted-foreground' />
                          MCP Access Token / Key
                        </Label>
                        <div className='relative'>
                          <Input
                            id='mcpKey'
                            type={showApiKey ? 'text' : 'password'}
                            value={mcpApiKey}
                            onChange={(e) => setMcpApiKey(e.target.value)}
                            placeholder='mcp_sk_...'
                            className='h-8 pr-8 text-xs font-mono'
                          />
                          <button
                            type='button'
                            onClick={() => setShowApiKey(!showApiKey)}
                            className='absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground'
                          >
                            {showApiKey ? (
                              <EyeOff className='size-3.5' />
                            ) : (
                              <Eye className='size-3.5' />
                            )}
                          </button>
                        </div>
                      </div>

                      <div className='space-y-2 pt-2'>
                        <Label className='text-xs font-medium'>
                          Allowed MCP Tools & Capabilities
                        </Label>
                        <div className='space-y-1.5 rounded-lg border border-border/80 bg-background/80 p-2.5'>
                          <label className='flex items-center gap-2 text-xs text-foreground cursor-pointer'>
                            <input
                              type='checkbox'
                              checked={allowDocRead}
                              onChange={(e) => setAllowDocRead(e.target.checked)}
                              className='size-3.5 rounded border-border text-primary'
                            />
                            <span>Read workspace specifications & Markdown</span>
                          </label>
                          <label className='flex items-center gap-2 text-xs text-foreground cursor-pointer'>
                            <input
                              type='checkbox'
                              checked={allowDiagramGen}
                              onChange={(e) => setAllowDiagramGen(e.target.checked)}
                              className='size-3.5 rounded border-border text-primary'
                            />
                            <span>Automated Mermaid flowchart & DBML schema generation</span>
                          </label>
                          <label className='flex items-center gap-2 text-xs text-foreground cursor-pointer'>
                            <input
                              type='checkbox'
                              checked={allowSearchIndex}
                              onChange={(e) => setAllowSearchIndex(e.target.checked)}
                              className='size-3.5 rounded border-border text-primary'
                            />
                            <span>Semantic indexing & cross-project document search</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className='rounded-xl border border-border/80 bg-card p-4 space-y-3'>
                  <div className='flex items-center justify-between'>
                    <div className='space-y-0.5'>
                      <div className='flex items-center gap-2'>
                        <Lock className='size-3.5 text-primary' />
                        <Label className='text-xs font-semibold cursor-pointer'>
                          Two-Factor Authentication (2FA)
                        </Label>
                      </div>
                      <p className='text-[11px] text-muted-foreground'>
                        Enforce authenticator app token on every sign in attempt.
                      </p>
                    </div>
                    <Switch
                      checked={twoFactorAuth}
                      onCheckedChange={setTwoFactorAuth}
                    />
                  </div>
                </div>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Change Name Dialog */}
      <Dialog open={editNameOpen} onOpenChange={setEditNameOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='text-base font-semibold'>Change Name</DialogTitle>
            <DialogDescription className='text-xs'>
              Enter your full display name as you would like it to appear in Dokudocs.
            </DialogDescription>
          </DialogHeader>
          <div className='py-2 space-y-2'>
            <Label htmlFor='nameInput' className='text-xs font-medium'>
              Full Name
            </Label>
            <Input
              id='nameInput'
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              placeholder='e.g. Fikri'
              className='h-8 text-xs'
              autoFocus
            />
          </div>
          <DialogFooter className='gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setEditNameOpen(false)}
              className='h-8 text-xs'
            >
              Cancel
            </Button>
            <Button
              type='button'
              size='sm'
              onClick={handleSaveName}
              className='h-8 text-xs'
            >
              Save Name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Email Dialog */}
      <Dialog open={editEmailOpen} onOpenChange={setEditEmailOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='text-base font-semibold'>Change Email</DialogTitle>
            <DialogDescription className='text-xs'>
              Your email is managed by your authentication provider. You will receive a verification link to confirm this update.
            </DialogDescription>
          </DialogHeader>
          <div className='py-2 space-y-2'>
            <Label htmlFor='emailInput' className='text-xs font-medium'>
              New Email Address
            </Label>
            <Input
              id='emailInput'
              type='email'
              value={tempEmail}
              onChange={(e) => setTempEmail(e.target.value)}
              placeholder='name@example.com'
              className='h-8 text-xs'
              autoFocus
            />
          </div>
          <DialogFooter className='gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setEditEmailOpen(false)}
              className='h-8 text-xs'
            >
              Cancel
            </Button>
            <Button
              type='button'
              size='sm'
              onClick={handleSaveEmail}
              className='h-8 text-xs'
            >
              Update Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Role Dialog */}
      <Dialog open={editRoleOpen} onOpenChange={setEditRoleOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='text-base font-semibold'>Change Role</DialogTitle>
            <DialogDescription className='text-xs'>
              Select or type your primary workspace role and title.
            </DialogDescription>
          </DialogHeader>
          <div className='py-2 space-y-3'>
            <div className='space-y-1.5'>
              <Label htmlFor='roleInput' className='text-xs font-medium'>
                Role Title
              </Label>
              <Input
                id='roleInput'
                value={tempRole}
                onChange={(e) => setTempRole(e.target.value)}
                placeholder='e.g. Web Developer'
                className='h-8 text-xs'
                autoFocus
              />
            </div>
            <div className='space-y-1.5'>
              <Label className='text-[11px] text-muted-foreground'>
                Popular suggestions:
              </Label>
              <div className='flex flex-wrap gap-1.5'>
                {predefinedRoles.map((r) => (
                  <button
                    key={r}
                    type='button'
                    onClick={() => setTempRole(r)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors cursor-pointer ${
                      tempRole === r
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border bg-muted/40 hover:bg-muted text-foreground'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className='gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setEditRoleOpen(false)}
              className='h-8 text-xs'
            >
              Cancel
            </Button>
            <Button
              type='button'
              size='sm'
              onClick={handleSaveRole}
              className='h-8 text-xs'
            >
              Save Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
