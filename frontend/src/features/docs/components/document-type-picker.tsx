import { useId } from 'react'
import { DOCUMENT_TYPES, type DocType } from '@/lib/document-types'

export function DocumentTypePicker({
  value,
  onChange,
}: {
  value: DocType
  onChange: (type: DocType) => void
}) {
  const descriptionId = useId()
  return (
    <div className='grid grid-cols-2 gap-2.5 pt-1 sm:grid-cols-4'>
      {DOCUMENT_TYPES.map((type) => {
        const Icon = type.icon
        const selected = value === type.value
        return (
          <button
            key={type.value}
            type='button'
            aria-label={type.label}
            aria-describedby={`${descriptionId}-${type.value}`}
            aria-pressed={selected}
            onClick={() => onChange(type.value)}
            className={`flex cursor-pointer flex-col items-start rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal ${selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border/80 hover:border-border hover:bg-muted/40'}`}
          >
            <div className='mb-1.5 flex flex-wrap items-center gap-2'>
              <div
                className={`rounded-md p-1.5 ${selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
              >
                <Icon className='size-3.5' />
              </div>
              <span className='text-xs font-semibold'>{type.label}</span>
            </div>
            <span
              id={`${descriptionId}-${type.value}`}
              className='line-clamp-2 text-[10px] leading-relaxed text-muted-foreground'
            >
              {type.description}
            </span>
          </button>
        )
      })}
    </div>
  )
}
