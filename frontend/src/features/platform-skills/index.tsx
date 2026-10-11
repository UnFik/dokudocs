import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch } from '@/lib/api-client'
import { listSkills, type Skill } from '@/lib/domain-api'
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
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Draft = {
  id?: string
  name: string
  description: string
  instructions: string
}
const EMPTY: Draft = { name: '', description: '', instructions: '' }

const saveSkill = (draft: Draft) =>
  apiFetch(
    draft.id
      ? `/api/v1/platform/skills/${draft.id}`
      : '/api/v1/platform/skills',
    {
      method: draft.id ? 'PUT' : 'POST',
      body: JSON.stringify({
        name: draft.name,
        description: draft.description,
        instructions: draft.instructions,
      }),
    }
  )

/** Skills: instructions a Superadmin writes once; every User calls them with /name. */
export function PlatformSkillsPage() {
  const queryClient = useQueryClient()
  const skills = useQuery({
    queryKey: ['skills'],
    queryFn: ({ signal }) => listSkills(signal),
    retry: false,
  })
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [deleting, setDeleting] = useState<Skill | null>(null)
  const save = useMutation({
    mutationFn: () => saveSkill(draft),
    onSuccess: async () => {
      setDraft(EMPTY)
      await queryClient.invalidateQueries({ queryKey: ['skills'] })
    },
    retry: false,
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/platform/skills/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
    retry: false,
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (draft.name.trim() && draft.instructions.trim()) save.mutate()
  }
  const edit = (field: keyof Draft, value: string) => {
    save.reset()
    setDraft({ ...draft, [field]: value })
  }
  return (
    <main className='flex flex-1 flex-col overflow-y-auto p-6'>
      <div className='mx-auto w-full max-w-4xl space-y-8'>
        <div className='space-y-1'>
          <h1 className='text-xl font-bold'>Skills</h1>
          <p className='text-sm text-muted-foreground'>
            Instructions for the assistant that every User calls by typing /name
            in a chat. AI apps see them as MCP prompts. A skill never gives the
            assistant more access.
          </p>
        </div>
        <form onSubmit={submit} className='space-y-4' noValidate>
          <h2 className='text-lg font-medium'>
            {draft.id ? `Edit /${draft.name}` : 'New skill'}
          </h2>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label htmlFor='skill-name'>Name</Label>
              <Input
                id='skill-name'
                value={draft.name}
                className='font-mono'
                placeholder='write-adr'
                onChange={(event) =>
                  edit('name', event.target.value.toLowerCase())
                }
              />
              <p className='text-xs text-muted-foreground'>
                Lowercase letters, digits and dashes, up to 48.
              </p>
            </div>
            <div className='space-y-1'>
              <Label htmlFor='skill-description'>Description</Label>
              <Input
                id='skill-description'
                value={draft.description}
                onChange={(event) => edit('description', event.target.value)}
              />
            </div>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='skill-instructions'>Instructions</Label>
            <Textarea
              id='skill-instructions'
              value={draft.instructions}
              className='min-h-32'
              onChange={(event) => edit('instructions', event.target.value)}
            />
          </div>
          {save.isError ? (
            <p role='alert' className='text-sm text-destructive'>
              {save.error instanceof ApiError
                ? save.error.title
                : 'Could not save the skill. Try again.'}
            </p>
          ) : null}
          <div className='flex gap-2'>
            <Button
              type='submit'
              disabled={
                !draft.name.trim() ||
                !draft.instructions.trim() ||
                save.isPending
              }
            >
              {draft.id ? 'Save skill' : 'Add skill'}
            </Button>
            {draft.id ? (
              <Button
                type='button'
                variant='outline'
                onClick={() => setDraft(EMPTY)}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
        <section aria-labelledby='skill-list' className='space-y-3'>
          <h2 id='skill-list' className='text-lg font-medium'>
            All skills
          </h2>
          {skills.isPending ? <p role='status'>Loading skills…</p> : null}
          {skills.isError ? (
            <p role='alert' className='text-sm text-destructive'>
              The skills could not be loaded.
            </p>
          ) : null}
          {skills.data?.length === 0 ? (
            <p className='text-sm text-muted-foreground'>No skills yet.</p>
          ) : null}
          {skills.data && skills.data.length > 0 ? (
            <ul className='divide-y border-y'>
              {skills.data.map((skill) => (
                <li
                  key={skill.id}
                  className='flex flex-wrap items-start gap-3 py-3'
                >
                  <div className='min-w-0 flex-1 space-y-1'>
                    <p className='font-mono text-sm'>/{skill.name}</p>
                    {skill.description ? (
                      <p className='text-xs text-muted-foreground'>
                        {skill.description}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    size='sm'
                    variant='outline'
                    aria-label={`Edit ${skill.name}`}
                    onClick={() =>
                      setDraft({
                        id: skill.id,
                        name: skill.name,
                        description: skill.description,
                        instructions: skill.instructions,
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    size='sm'
                    variant='danger'
                    aria-label={`Delete ${skill.name}`}
                    onClick={() => setDeleting(skill)}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        <AlertDialog
          open={deleting !== null}
          onOpenChange={(open) => !open && setDeleting(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete /{deleting?.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Users can no longer call it. Past answers stay as they were.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: 'destructive' })}
                onClick={() => {
                  if (deleting) remove.mutate(deleting.id)
                  setDeleting(null)
                }}
              >
                Delete skill
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </main>
  )
}
