import { DocType } from '@/types/dokudocs'
import { Database, FileText, GitFork } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

interface DocTypeBadgeProps {
  type: DocType
  className?: string
  showIcon?: boolean
}

export function DocTypeBadge({
  type,
  className,
  showIcon = true,
}: DocTypeBadgeProps) {
  const configs = {
    markdown: {
      label: 'Markdown',
      icon: FileText,
      style:
        'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
    },
    dbdiagram: {
      label: 'DBML',
      icon: Database,
      style: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
    },
    mermaid: {
      label: 'Mermaid',
      icon: GitFork,
      style: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
    },
  }

  const config = configs[type] || configs.markdown
  const Icon = config.icon

  return (
    <Badge
      variant='outline'
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium transition-colors',
        config.style,
        className
      )}
    >
      {showIcon && <Icon className='size-3 shrink-0' />}
      <span>{config.label}</span>
    </Badge>
  )
}
