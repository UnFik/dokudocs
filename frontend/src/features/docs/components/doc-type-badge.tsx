import { Database, FileText, GitFork } from 'lucide-react'
import { DocType } from '@/types/dokudocs'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

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
      label: 'FSD / Markdown',
      icon: FileText,
      style: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    },
    dbdiagram: {
      label: 'DB Diagram',
      icon: Database,
      style: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    },
    mermaid: {
      label: 'Flowchart',
      icon: GitFork,
      style: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
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
