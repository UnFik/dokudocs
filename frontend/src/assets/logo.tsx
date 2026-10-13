import { type SVGProps } from 'react'
import { cn } from '@/lib/utils'

export function Logo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      id='dokudocs-logo'
      viewBox='56 48 144 160'
      xmlns='http://www.w3.org/2000/svg'
      height='24'
      width='24'
      fill='currentColor'
      className={cn('size-6', className)}
      {...props}
    >
      <title>Dokudocs</title>
      <path d='M56 48H120A80 80 0 0 1 176.6 71.4L56 192Z' />
      <path className='fill-signal' d='M56 208L184 80A80 80 0 0 1 120 208Z' />
    </svg>
  )
}
