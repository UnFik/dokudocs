import type { DocType } from '@/types/dokudocs'
import { getDocumentType } from '@/lib/document-types'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

interface DocTypeBadgeProps {
  type: DocType
  className?: string
}

// Document type is named by label, never by hue (DESIGN.md: tags).
export function DocTypeBadge({ type, className }: DocTypeBadgeProps) {
  return (
    <Badge variant='tag' className={cn('shrink-0', className)}>
      {getDocumentType(type).label}
    </Badge>
  )
}
