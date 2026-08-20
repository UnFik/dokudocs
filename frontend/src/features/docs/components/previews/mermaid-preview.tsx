import { useMemo, useState } from 'react'
import { AlertCircle, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface MermaidPreviewProps {
  content: string
}

interface MermaidNode {
  id: string
  label: string
  shape?: 'box' | 'round' | 'rhombus'
}

interface MermaidLink {
  from: string
  to: string
  label?: string
}

export function MermaidPreview({ content }: MermaidPreviewProps) {
  const [zoom, setZoom] = useState(1)

  const parsedDiagram = useMemo(() => {
    if (!content.trim()) return { nodes: [], links: [], type: 'graph', isValid: true }

    const lines = content.split('\n')
    const nodesMap = new Map<string, MermaidNode>()
    const links: MermaidLink[] = []

    let isSequence = content.toLowerCase().includes('sequencediagram')
    let isValid = true

    try {
      lines.forEach((line) => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('%%')) return

        const linkMatch = trimmed.match(
          /(\w+)(?:\[(.*?)\]|\{(.*?)\})?\s*-->\s*(?:\|(.*?)\|)?\s*(\w+)(?:\[(.*?)\]|\{(.*?)\})?/
        )
        if (linkMatch) {
          const fromId = linkMatch[1]
          const fromLabel = linkMatch[2] || linkMatch[3] || fromId
          const linkText = linkMatch[4]
          const toId = linkMatch[5]
          const toLabel = linkMatch[6] || linkMatch[7] || toId

          if (!nodesMap.has(fromId)) {
            nodesMap.set(fromId, { id: fromId, label: fromLabel })
          }
          if (!nodesMap.has(toId)) {
            nodesMap.set(toId, { id: toId, label: toLabel })
          }

          links.push({ from: fromId, to: toId, label: linkText })
        }
      })
    } catch {
      isValid = false
    }

    return {
      nodes: Array.from(nodesMap.values()),
      links,
      type: isSequence ? 'sequence' : 'graph',
      isValid,
    }
  }, [content])

  return (
    <div className='relative h-full w-full overflow-auto bg-muted/20 p-6 select-none'>
      <div className='absolute top-4 right-4 z-10 flex items-center gap-1 rounded-lg border border-border bg-background/90 p-1 shadow-sm backdrop-blur-xs'>
        <Button
          variant='ghost'
          size='icon'
          className='size-7'
          onClick={() => setZoom((z) => Math.min(z + 0.15, 2))}
        >
          <ZoomIn className='size-3.5' />
        </Button>
        <span className='px-1 font-mono text-[10px] font-semibold text-muted-foreground'>
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant='ghost'
          size='icon'
          className='size-7'
          onClick={() => setZoom((z) => Math.max(z - 0.15, 0.5))}
        >
          <ZoomOut className='size-3.5' />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='size-7'
          onClick={() => setZoom(1)}
        >
          <RotateCcw className='size-3.5' />
        </Button>
      </div>

      {!parsedDiagram.isValid && (
        <div className='mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive'>
          <AlertCircle className='size-4 shrink-0' />
          <span>Invalid Mermaid syntax in editor. Check diagram syntax.</span>
        </div>
      )}

      {parsedDiagram.nodes.length === 0 ? (
        <div className='flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground italic'>
          <p>Flowchart Diagram Preview Engine Active</p>
          <p className='text-[10px] not-italic text-muted-foreground/70'>
            Type standard Mermaid syntax (e.g. A[Start] --&gt; B[Process]) to render diagram
          </p>
        </div>
      ) : (
        <div
          className='flex flex-col items-center justify-center gap-6 py-8 transition-transform duration-150 origin-top'
          style={{ transform: `scale(${zoom})` }}
        >
          {parsedDiagram.nodes.map((node, index) => {
            const outgoingLinks = parsedDiagram.links.filter((l) => l.from === node.id)
            return (
              <div key={node.id} className='flex flex-col items-center gap-4'>
                <div className='flex items-center justify-center rounded-xl border border-purple-500/40 bg-card px-5 py-3 shadow-md transition-shadow hover:shadow-lg'>
                  <span className='font-mono text-xs font-semibold text-purple-600 dark:text-purple-400'>
                    {node.label}
                  </span>
                </div>

                {index < parsedDiagram.nodes.length - 1 && (
                  <div className='flex flex-col items-center gap-1 my-1 text-[10px] text-muted-foreground font-mono'>
                    {outgoingLinks[0]?.label && (
                      <span className='rounded bg-purple-500/10 px-1.5 py-0.5 text-purple-600 dark:text-purple-400 font-semibold'>
                        {outgoingLinks[0].label}
                      </span>
                    )}
                    <div className='h-6 w-0.5 bg-purple-500/40' />
                    <div className='size-0 border-x-4 border-x-transparent border-t-6 border-t-purple-500/60' />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
