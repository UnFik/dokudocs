import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  PROTOCOLS,
  saveSettingApi,
  testSettingApi,
  type Purpose,
  type SettingInput,
  type SettingView,
} from './api/platform-ai-api'

const BLANK: SettingInput = {
  baseURL: 'https://api.openai.com/v1',
  protocol: 'openai_responses',
  model: '',
  apiKey: '',
}

function hostOf(address: string) {
  try {
    return new URL(address.trim()).host
  } catch {
    return address.trim()
  }
}

function problemText(error: unknown, fallback: string) {
  return error instanceof ApiError && error.title ? error.title : fallback
}

/** One provider setting: where the model lives, which model, and the key (never shown, only replaced). */
export function ProviderSection({
  purpose,
  title,
  modelLabel,
  setting,
  note,
}: {
  purpose: Purpose
  title: string
  modelLabel: string
  setting: SettingView | null
  note?: string
}) {
  const queryClient = useQueryClient()
  const baseline: SettingInput = setting
    ? {
        baseURL: setting.baseURL,
        protocol: setting.protocol,
        model: setting.model,
        apiKey: '',
      }
    : BLANK
  const [draft, setDraft] = useState<SettingInput | null>(null)
  const values = draft ?? baseline
  const changed =
    draft !== null &&
    (draft.baseURL !== baseline.baseURL ||
      draft.protocol !== baseline.protocol ||
      draft.model !== baseline.model ||
      draft.apiKey !== '')
  // A stored key belongs to the address it was made for; another address needs its own key.
  const addressChanged =
    setting !== null && hostOf(values.baseURL) !== hostOf(baseline.baseURL)
  const needsKey = setting === null || addressChanged
  const ready =
    values.baseURL.trim() !== '' &&
    values.model.trim() !== '' &&
    (!needsKey || values.apiKey.trim() !== '')

  const test = useMutation({
    mutationFn: () => testSettingApi(purpose, values),
    retry: false,
  })
  const save = useMutation({
    mutationFn: () => saveSettingApi(purpose, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform-ai'] })
      setDraft(null)
    },
    retry: false,
  })
  const busy = test.isPending || save.isPending

  function change(patch: Partial<SettingInput>) {
    test.reset()
    save.reset()
    setDraft({ ...values, ...patch })
  }
  const id = (field: string) => `${purpose}-${field}`
  const failure = save.isError
    ? problemText(save.error, 'Could not save the setting. Try again.')
    : test.isError
      ? problemText(test.error, 'Could not reach the provider. Try again.')
      : ''

  return (
    <section aria-labelledby={id('title')} className='space-y-4'>
      <div className='space-y-1'>
        <h2 id={id('title')} className='text-lg font-medium'>
          {title}
        </h2>
        {note && <p className='text-sm text-muted-foreground'>{note}</p>}
      </div>
      {setting?.lastError && (
        <p
          role='status'
          className='flex items-center gap-2 text-sm text-destructive'
        >
          <span
            aria-hidden
            className='size-1.5 shrink-0 rounded-[1px] bg-destructive'
          />
          <span>
            The last request failed:{' '}
            <span className='font-mono'>{setting.lastError}</span>
          </span>
        </p>
      )}
      <form
        className='space-y-4'
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (ready) save.mutate()
        }}
      >
        <div className='space-y-2'>
          <Label htmlFor={id('base-url')}>Base URL</Label>
          <Input
            id={id('base-url')}
            value={values.baseURL}
            inputMode='url'
            autoComplete='off'
            onChange={(event) => change({ baseURL: event.target.value })}
          />
          <p className='text-xs text-muted-foreground'>
            Starts with https://. Requests go to this address followed by
            /responses, /chat/completions or /embeddings.
          </p>
        </div>
        <fieldset className='space-y-2'>
          <legend className='text-sm font-medium'>Protocol</legend>
          <RadioGroup
            value={values.protocol}
            onValueChange={(protocol) => change({ protocol })}
            className='flex flex-wrap gap-4'
          >
            {PROTOCOLS.map(({ value, label }) => (
              <div key={value} className='flex items-center gap-2'>
                <RadioGroupItem value={value} id={id(`protocol-${value}`)} />
                <Label htmlFor={id(`protocol-${value}`)}>{label}</Label>
              </div>
            ))}
          </RadioGroup>
          {purpose === 'embedding' && (
            <p className='text-xs text-muted-foreground'>
              Embedding requests always use /embeddings, whichever you pick.
            </p>
          )}
        </fieldset>
        <div className='space-y-2'>
          <Label htmlFor={id('model')}>{modelLabel}</Label>
          <Input
            id={id('model')}
            value={values.model}
            autoComplete='off'
            spellCheck={false}
            className='font-mono'
            onChange={(event) => change({ model: event.target.value })}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor={id('api-key')}>API key</Label>
          <Input
            id={id('api-key')}
            type='password'
            value={values.apiKey}
            autoComplete='new-password'
            onChange={(event) => change({ apiKey: event.target.value })}
          />
          <p className='text-xs text-muted-foreground'>
            {addressChanged ? (
              <>
                Enter the API key for the new address. The stored key is not
                sent there.
              </>
            ) : setting ? (
              <>
                Stored key ends{' '}
                <span className='font-mono'>{setting.keyHint}</span>. Leave this
                empty to keep it.
              </>
            ) : (
              'No key is stored yet. It is kept encrypted and is never shown again.'
            )}
          </p>
        </div>
        {failure && (
          <p role='alert' className='text-sm text-destructive'>
            {failure}
          </p>
        )}
        {test.isSuccess && (
          <p role='status' className='text-sm'>
            Connection works.
          </p>
        )}
        {save.isSuccess && !changed && (
          <p role='status' className='text-sm'>
            Saved.
          </p>
        )}
        <div className='flex flex-wrap gap-2'>
          <Button
            type='button'
            variant='outline'
            disabled={!ready || busy}
            onClick={() => test.mutate()}
            aria-label={`Test ${purpose} connection`}
          >
            {test.isPending ? 'Testing...' : 'Test connection'}
          </Button>
          <Button
            type='submit'
            disabled={!ready || !changed || busy}
            aria-label={`Save ${purpose} provider`}
          >
            {save.isPending ? 'Testing and saving...' : 'Save'}
          </Button>
        </div>
      </form>
    </section>
  )
}
