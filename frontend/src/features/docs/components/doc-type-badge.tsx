import type { DocType } from '@/types/dokudocs'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

interface DocTypeBadgeProps {
  type: DocType
  className?: string
}

const LABELS: Record<DocType, string> = {
  markdown: 'Markdown',
  dbdiagram: 'DBML',
  mermaid: 'Mermaid',
  architecture: 'Architecture',
}

// Document type is named by label, never by hue (DESIGN.md: tags).
export function DocTypeBadge({ type, className }: DocTypeBadgeProps) {
  return (
    <Badge variant='tag' className={cn('shrink-0', className)}>
      {LABELS[type] ?? LABELS.markdown}
    </Badge>
  )
}
