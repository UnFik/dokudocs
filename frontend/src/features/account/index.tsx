import { useRef, useState } from 'react'
import {
  Camera,
  Mail,
  Phone,
  User,
} from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuthStore } from '@/stores/auth-store'
import { sidebarData } from '@/components/layout/data/sidebar-data'

export function AccountPage() {
  const { auth } = useAuthStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const defaultUser = auth.user
    ? {
        name: auth.user.accountNo || 'Fikri',
        email: auth.user.email || 'fikriilhamarifin27@gmail.com',
        avatar: sidebarData.user.avatar || '/avatars/01.png',
      }
    : {
        name: 'Fikri',
        email: 'fikriilhamarifin27@gmail.com',
        avatar: '/avatars/01.png',
      }

  const [fullName, setFullName] = useState(defaultUser.name)
  const [email, setEmail] = useState(defaultUser.email)
  const [phoneNumber, setPhoneNumber] = useState('+1 (555) 000-0000')
  const [bio, setBio] = useState('Product builder & documentation craftsman.')
  const [avatarUrl, setAvatarUrl] = useState(defaultUser.avatar)
  const [saving, setSaving] = useState(false)

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const url = URL.createObjectURL(file)
      setAvatarUrl(url)
      toast.success('Avatar updated')
    }
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    setTimeout(() => {
      setSaving(false)
      toast.success('Account profile updated successfully')
    }, 400)
  }

  return (
    <div className='flex flex-1 flex-col p-6 overflow-y-auto'>
      <div className='max-w-4xl mx-auto w-full space-y-6'>
        <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-5'>
          <div>
            <div className='flex items-center gap-2.5'>
              <div className='flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                <User className='size-4' />
              </div>
              <h1 className='text-xl font-bold tracking-tight text-foreground'>
                Account
              </h1>
            </div>
            <p className='mt-1 text-xs text-muted-foreground'>
              Manage your personal profile, contact information, and public identity.
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className='space-y-6 pb-12'>
          <div className='rounded-xl border border-border/70 bg-card/60 p-6 shadow-xs'>
            <div className='flex items-center justify-between gap-4'>
              <div className='space-y-1 pr-4'>
                <h2 className='text-sm font-semibold text-foreground'>Avatar</h2>
                <p className='text-xs text-muted-foreground'>
                  This is your avatar.
                </p>
                <p className='text-xs text-muted-foreground'>
                  Click on the avatar to upload a custom one from your files.
                </p>
              </div>
              <div
                onClick={handleAvatarClick}
                className='relative group cursor-pointer shrink-0'
                title='Click to change avatar'
              >
                <Avatar className='h-16 w-16 rounded-full border-2 border-border transition-all group-hover:opacity-80'>
                  <AvatarImage src={avatarUrl} alt={fullName} />
                  <AvatarFallback className='text-base font-semibold'>
                    {fullName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className='absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100'>
                  <Camera className='size-5 text-white' />
                </div>
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='image/*'
                  onChange={handleFileChange}
                  className='hidden'
                />
              </div>
            </div>
          </div>

          <div className='rounded-xl border border-border/70 bg-card/60 p-6 shadow-xs space-y-3'>
            <div>
              <h2 className='text-sm font-semibold text-foreground'>Display Name</h2>
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='full-name' className='text-xs font-medium text-muted-foreground'>
                Full Name
              </Label>
              <Input
                id='full-name'
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className='text-xs max-w-xl'
              />
            </div>
          </div>

          <div className='rounded-xl border border-border/70 bg-card/60 p-6 shadow-xs space-y-3'>
            <div>
              <h2 className='text-sm font-semibold text-foreground'>Email Address</h2>
            </div>
            <div className='relative max-w-xl'>
              <Mail className='absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground' />
              <Input
                type='email'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className='text-xs pl-9'
              />
            </div>
          </div>

          <div className='rounded-xl border border-border/70 bg-card/60 p-6 shadow-xs space-y-3'>
            <div>
              <h2 className='text-sm font-semibold text-foreground'>Phone Number</h2>
              <p className='text-xs text-muted-foreground mt-0.5'>
                Optional phone number for account recovery
              </p>
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='phone-number' className='text-xs font-medium text-muted-foreground'>
                Phone Number
              </Label>
              <div className='relative max-w-xl'>
                <Phone className='absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground' />
                <Input
                  id='phone-number'
                  type='tel'
                  placeholder='+1 (555) 000-0000'
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className='text-xs pl-9'
                />
              </div>
            </div>
          </div>

          <div className='rounded-xl border border-border/70 bg-card/60 p-6 shadow-xs space-y-3'>
            <div>
              <h2 className='text-sm font-semibold text-foreground'>Bio</h2>
              <p className='text-xs text-muted-foreground mt-0.5'>
                A short bio about yourself
              </p>
            </div>
            <div className='max-w-xl space-y-1'>
              <Textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder='Tell us a little bit about yourself...'
                rows={3}
                className='text-xs resize-none'
              />
            </div>
          </div>

          <div className='flex items-center gap-3 pt-2'>
            <Button type='submit' size='sm' disabled={saving} className='text-xs px-5'>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
