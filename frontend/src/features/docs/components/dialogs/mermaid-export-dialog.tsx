import { useMemo, useState } from 'react'
import {
  Check,
  Copy,
  Download,
  FileCode,
  FileText,
  Image as ImageIcon,
  Palette,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { renderMermaidSvgDirect } from '../../hooks/use-mermaid-render'

export type MermaidExportFormat = 'png' | 'svg' | 'pdf' | 'mmd'
export type MermaidBackgroundType = 'transparent' | 'light' | 'dark' | 'custom'
export type MermaidDiagramTheme = 'colorful' | 'default' | 'forest' | 'dark' | 'neutral'

interface MermaidExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  docTitle: string
  content: string
  svg: string
}

const CHECKERBOARD_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%2371717a' fill-opacity='0.16'%3E%3Crect width='8' height='8'/%3E%3Crect x='8' y='8' width='8' height='8'/%3E%3C/svg%3E\")"

const THEME_OPTIONS = [
  { id: 'default', label: 'Auto / Default', color: '#3b82f6' },
  { id: 'dark', label: 'Dark', color: '#64748b' },
  { id: 'forest', label: 'Forest', color: '#10b981' },
  { id: 'neutral', label: 'Neutral', color: '#71717a' },
] as const

const BACKGROUND_PRESETS = [
  { id: 'transparent', label: 'Transparent', color: 'transparent' },
  { id: 'light', label: 'Light', color: '#ffffff' },
  { id: 'dark', label: 'Dark', color: '#09090b' },
  { id: 'custom', label: 'Custom', color: '#1e293b' },
] as const

const SCALE_OPTIONS = [
  { value: 1, label: '1x (Std)' },
  { value: 2, label: '2x (HD)' },
  { value: 3, label: '3x (UHD)' },
  { value: 4, label: '4x (Print)' },
]

function computeIsTargetDark(
  themeName: MermaidDiagramTheme,
  bg: MermaidBackgroundType,
  customHex: string
): boolean {
  if (themeName === 'dark') return true
  if (bg === 'dark') return true
  if (bg === 'light') return false
  if (bg === 'custom') {
    const hex = customHex.replace('#', '')
    if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16)
      const g = parseInt(hex.substring(2, 4), 16)
      const b = parseInt(hex.substring(4, 6), 16)
      const yiq = (r * 299 + g * 587 + b * 114) / 1000
      return yiq < 128
    }
  }
  return false
}

export function MermaidExportDialog({
  open,
  onOpenChange,
  docTitle,
  content,
  svg,
}: MermaidExportDialogProps) {
  const [format, setFormat] = useState<MermaidExportFormat>('png')
  const [theme, setTheme] = useState<MermaidDiagramTheme>('default')
  const [bgType, setBgType] = useState<MermaidBackgroundType>('transparent')
  const [customBgColor, setCustomBgColor] = useState('#1e293b')
  const [scale, setScale] = useState(2)
  const [isExporting, setIsExporting] = useState(false)
  const [hasCopied, setHasCopied] = useState(false)
  const [renderedCustomSvg, setRenderedCustomSvg] = useState<string | null>(null)

  const activeSvg = renderedCustomSvg || svg

  const effectiveBgColor = useMemo(() => {
    if (bgType === 'transparent') return 'transparent'
    if (bgType === 'light') return '#ffffff'
    if (bgType === 'dark') return '#09090b'
    return customBgColor
  }, [bgType, customBgColor])

  const sanitizedFileName = useMemo(() => {
    const base = docTitle.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'mermaid_diagram'
    return `${base}.${format}`
  }, [docTitle, format])

  const getExportSvgXml = useMemo(() => {
    if (!activeSvg) return ''
    if (bgType === 'transparent') return activeSvg

    const bgRect = `<rect width="100%" height="100%" fill="${effectiveBgColor}"/>`
    return activeSvg.replace(/(<svg[^>]*>)/i, `$1${bgRect}`)
  }, [activeSvg, bgType, effectiveBgColor])

  const handleThemeChange = async (nextTheme: MermaidDiagramTheme) => {
    setTheme(nextTheme)
    if (!content) return
    const isDark = computeIsTargetDark(nextTheme, bgType, customBgColor)
    try {
      const nextSvg = await renderMermaidSvgDirect(content, isDark, nextTheme)
      setRenderedCustomSvg(nextSvg)
    } catch {
      // Keep previous SVG on render failure
    }
  }

  const handleBgTypeChange = async (nextBgType: MermaidBackgroundType) => {
    setBgType(nextBgType)
    if (!content) return
    const isDark = computeIsTargetDark(theme, nextBgType, customBgColor)
    try {
      const nextSvg = await renderMermaidSvgDirect(content, isDark, theme)
      setRenderedCustomSvg(nextSvg)
    } catch {
      // Keep previous SVG on render failure
    }
  }

  const handleCustomColorChange = async (color: string) => {
    setCustomBgColor(color)
    if (!content || bgType !== 'custom') return
    const isDark = computeIsTargetDark(theme, 'custom', color)
    try {
      const nextSvg = await renderMermaidSvgDirect(content, isDark, theme)
      setRenderedCustomSvg(nextSvg)
    } catch {
      // Keep previous SVG on render failure
    }
  }

  const renderSvgToCanvas = async (multiplier: number): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> => {
    const parser = new DOMParser()
    const doc = parser.parseFromString(activeSvg, 'image/svg+xml')
    const svgEl = doc.querySelector('svg')
    if (!svgEl) throw new Error('SVG not found')

    const viewBox = svgEl.viewBox?.baseVal
    let baseWidth = viewBox && viewBox.width > 0 ? viewBox.width : parseFloat(svgEl.getAttribute('width') || '800')
    let baseHeight = viewBox && viewBox.height > 0 ? viewBox.height : parseFloat(svgEl.getAttribute('height') || '600')

    if (!baseWidth || isNaN(baseWidth) || baseWidth <= 0) baseWidth = 800
    if (!baseHeight || isNaN(baseHeight) || baseHeight <= 0) baseHeight = 600

    const width = Math.round(baseWidth * multiplier)
    const height = Math.round(baseHeight * multiplier)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not create canvas context')

    if (effectiveBgColor !== 'transparent') {
      ctx.fillStyle = effectiveBgColor
      ctx.fillRect(0, 0, width, height)
    }

    const xml = getExportSvgXml
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    await new Promise<void>((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height)
        URL.revokeObjectURL(url)
        resolve()
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('Failed to load SVG for rasterization'))
      }
      img.src = url
    })

    return { canvas, width, height }
  }

  const handleDownload = async () => {
    if (!activeSvg && format !== 'mmd') {
      toast.error('No diagram SVG available to export')
      return
    }

    setIsExporting(true)
    try {
      if (format === 'mmd') {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = sanitizedFileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        toast.success(`Exported ${sanitizedFileName}`)
        onOpenChange(false)
        return
      }

      if (format === 'svg') {
        const xml = getExportSvgXml
        const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = sanitizedFileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        toast.success(`Exported ${sanitizedFileName}`)
        onOpenChange(false)
        return
      }

      if (format === 'png') {
        const { canvas } = await renderSvgToCanvas(scale)
        const pngUrl = canvas.toDataURL('image/png')
        const a = document.createElement('a')
        a.href = pngUrl
        a.download = sanitizedFileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        toast.success(`Exported ${sanitizedFileName}`)
        onOpenChange(false)
        return
      }

      if (format === 'pdf') {
        const { canvas, width, height } = await renderSvgToCanvas(Math.max(scale, 2))
        const orientation = width > height ? 'landscape' : 'portrait'
        const { jsPDF } = await import('jspdf')
        const pdf = new jsPDF({
          orientation,
          unit: 'pt',
          format: [width, height],
        })

        const imgData = canvas.toDataURL('image/png')
        pdf.addImage(imgData, 'PNG', 0, 0, width, height)
        pdf.save(sanitizedFileName)
        toast.success(`Exported ${sanitizedFileName}`)
        onOpenChange(false)
        return
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg || 'Failed to export diagram')
    } finally {
      setIsExporting(false)
    }
  }

  const handleCopyClipboard = async () => {
    if (!activeSvg && format !== 'mmd') {
      toast.error('No diagram SVG available to copy')
      return
    }

    try {
      if (format === 'mmd') {
        await navigator.clipboard.writeText(content)
        setHasCopied(true)
        setTimeout(() => setHasCopied(false), 2000)
        toast.success('Mermaid code copied to clipboard')
        return
      }

      if (format === 'svg') {
        await navigator.clipboard.writeText(getExportSvgXml)
        setHasCopied(true)
        setTimeout(() => setHasCopied(false), 2000)
        toast.success('SVG markup copied to clipboard')
        return
      }

      if (format === 'png') {
        const { canvas } = await renderSvgToCanvas(scale)
        canvas.toBlob(async (blob) => {
          if (!blob) {
            toast.error('Failed to create PNG blob')
            return
          }
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ])
          setHasCopied(true)
          setTimeout(() => setHasCopied(false), 2000)
          toast.success('PNG image copied to clipboard')
        }, 'image/png')
        return
      }

      if (format === 'pdf') {
        toast.info('PDF clipboard copy is not supported. Please use Download.')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg || 'Failed to copy to clipboard')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-2xl sm:max-w-3xl p-0 overflow-hidden max-h-[90vh] flex flex-col'>
        <DialogHeader className='border-b border-border/80 px-5 py-3.5'>
          <DialogTitle className='flex items-center gap-2 text-sm sm:text-base font-bold'>
            <Download className='size-4 text-primary' />
            <span>Export Mermaid Diagram</span>
          </DialogTitle>
          <DialogDescription className='text-xs'>
            Choose export format, color theme, and resolution settings.
          </DialogDescription>
        </DialogHeader>

        <div className='grid grid-cols-1 md:grid-cols-12 flex-1 min-h-0 overflow-hidden'>
          <div className='md:col-span-5 flex flex-col justify-between border-b md:border-b-0 md:border-r border-border/80 p-4 sm:p-5 bg-muted/10 space-y-4 overflow-y-auto'>
            <div className='space-y-3.5'>
              <div className='space-y-1.5'>
                <Label className='text-[11px] font-semibold text-foreground'>Format</Label>
                <div className='grid grid-cols-4 gap-1 p-0.5 rounded-lg border border-border/80 bg-background'>
                  <Button
                    type='button'
                    variant={format === 'png' ? 'default' : 'ghost'}
                    size='sm'
                    onClick={() => setFormat('png')}
                    className='h-7 text-xs font-medium px-1'
                  >
                    <ImageIcon className='size-3 mr-1' />
                    PNG
                  </Button>
                  <Button
                    type='button'
                    variant={format === 'svg' ? 'default' : 'ghost'}
                    size='sm'
                    onClick={() => setFormat('svg')}
                    className='h-7 text-xs font-medium px-1'
                  >
                    <FileCode className='size-3 mr-1' />
                    SVG
                  </Button>
                  <Button
                    type='button'
                    variant={format === 'pdf' ? 'default' : 'ghost'}
                    size='sm'
                    onClick={() => setFormat('pdf')}
                    className='h-7 text-xs font-medium px-1'
                  >
                    <FileText className='size-3 mr-1' />
                    PDF
                  </Button>
                  <Button
                    type='button'
                    variant={format === 'mmd' ? 'default' : 'ghost'}
                    size='sm'
                    onClick={() => setFormat('mmd')}
                    className='h-7 text-xs font-medium px-1'
                  >
                    <Sparkles className='size-3 mr-1' />
                    MMD
                  </Button>
                </div>
              </div>

              {format !== 'mmd' && (
                <>
                  <div className='space-y-1.5'>
                    <Label className='text-[11px] font-semibold text-foreground flex items-center justify-between'>
                      <span>Diagram Theme</span>
                      <span className='text-[10px] font-mono text-muted-foreground capitalize'>{theme}</span>
                    </Label>
                    <div className='grid grid-cols-5 gap-1'>
                      {THEME_OPTIONS.map((opt) => {
                        const isSelected = theme === opt.id
                        return (
                          <button
                            key={opt.id}
                            type='button'
                            onClick={() => handleThemeChange(opt.id as MermaidDiagramTheme)}
                            className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border text-xs font-medium transition-all ${
                              isSelected
                                ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary'
                                : 'border-border/80 bg-background hover:bg-muted/50 text-muted-foreground'
                            }`}
                          >
                            <span
                              className='size-3 rounded-full border border-border/80 shadow-xs'
                              style={{ backgroundColor: opt.color }}
                            />
                            <span className='text-[10px] truncate w-full text-center'>{opt.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className='space-y-1.5'>
                    <Label className='text-[11px] font-semibold text-foreground flex items-center justify-between'>
                      <span>Background</span>
                      <span className='text-[10px] font-mono text-muted-foreground uppercase'>{effectiveBgColor}</span>
                    </Label>
                    <div className='grid grid-cols-4 gap-1.5'>
                      {BACKGROUND_PRESETS.map((preset) => {
                        const isSelected = bgType === preset.id
                        return (
                          <button
                            key={preset.id}
                            type='button'
                            onClick={() => handleBgTypeChange(preset.id as MermaidBackgroundType)}
                            className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border text-xs font-medium transition-all ${
                              isSelected
                                ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary'
                                : 'border-border/80 bg-background hover:bg-muted/50 text-muted-foreground'
                            }`}
                          >
                            <div
                              className='size-4 rounded-full border border-border/80 shadow-xs'
                              style={{
                                backgroundColor: preset.id === 'custom' ? customBgColor : preset.color,
                                backgroundImage: preset.id === 'transparent' ? CHECKERBOARD_BG : undefined,
                                backgroundSize: preset.id === 'transparent' ? '6px 6px' : undefined,
                              }}
                            />
                            <span className='text-[10px] truncate w-full text-center'>{preset.label}</span>
                          </button>
                        )
                      })}
                    </div>

                    {bgType === 'custom' && (
                      <div className='flex items-center gap-2 mt-1.5 pt-1.5 border-t border-border/60'>
                        <div className='relative flex items-center gap-1.5 flex-1'>
                          <input
                            type='color'
                            value={customBgColor}
                            onChange={(e) => handleCustomColorChange(e.target.value)}
                            className='size-6 rounded cursor-pointer border border-border/80 bg-transparent p-0.5'
                          />
                          <Input
                            type='text'
                            value={customBgColor}
                            onChange={(e) => handleCustomColorChange(e.target.value)}
                            className='h-6 text-[11px] font-mono'
                            placeholder='#1e293b'
                          />
                        </div>
                        <Palette className='size-3.5 text-muted-foreground' />
                      </div>
                    )}
                  </div>
                </>
              )}

              {(format === 'png' || format === 'pdf') && (
                <div className='space-y-1.5'>
                  <Label className='text-[11px] font-semibold text-foreground'>Resolution / Scale</Label>
                  <div className='grid grid-cols-4 gap-1'>
                    {SCALE_OPTIONS.map((opt) => (
                      <Button
                        key={opt.value}
                        type='button'
                        variant={scale === opt.value ? 'default' : 'outline'}
                        size='sm'
                        onClick={() => setScale(opt.value)}
                        className='h-6 text-[10px] px-1 font-medium'
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <div className='space-y-1'>
                <Label className='text-[10px] text-muted-foreground'>File Name</Label>
                <div className='font-mono text-[11px] text-foreground truncate bg-background border border-border/70 rounded-md px-2 py-1'>
                  {sanitizedFileName}
                </div>
              </div>
            </div>

            <div className='space-y-1.5 pt-3 border-t border-border/80'>
              <Button
                type='button'
                onClick={handleDownload}
                disabled={isExporting}
                className='w-full h-8 gap-1.5 text-xs font-semibold shadow-sm'
              >
                <Download className='size-3.5' />
                <span>{isExporting ? 'Exporting...' : `Download ${format.toUpperCase()}`}</span>
              </Button>

              {format !== 'pdf' && (
                <Button
                  type='button'
                  variant='outline'
                  onClick={handleCopyClipboard}
                  className='w-full h-7 gap-1.5 text-xs font-medium'
                >
                  {hasCopied ? <Check className='size-3.5 text-emerald-500' /> : <Copy className='size-3.5' />}
                  <span>{hasCopied ? 'Copied to Clipboard!' : `Copy ${format.toUpperCase()}`}</span>
                </Button>
              )}
            </div>
          </div>

          <div className='md:col-span-7 flex flex-col p-4 sm:p-5 bg-muted/20 min-h-0 justify-between'>
            <div className='flex items-center justify-between mb-2 text-xs font-semibold text-muted-foreground'>
              <span>Preview</span>
              <span className='text-[10px] font-mono rounded bg-muted/80 px-2 py-0.5 border border-border/60'>
                {format.toUpperCase()} • {theme} • {bgType}
              </span>
            </div>

            <div
              className='relative flex-1 min-h-[240px] max-h-[360px] sm:max-h-[420px] rounded-xl border border-border/80 overflow-hidden flex items-center justify-center p-4 transition-colors shadow-inner'
              style={{
                backgroundColor: effectiveBgColor === 'transparent' ? 'var(--background)' : effectiveBgColor,
                backgroundImage: effectiveBgColor === 'transparent' ? CHECKERBOARD_BG : undefined,
                backgroundSize: effectiveBgColor === 'transparent' ? '16px 16px' : undefined,
              }}
            >
              {format === 'mmd' ? (
                <div className='size-full overflow-auto bg-background/95 border border-border/80 rounded-lg p-3 font-mono text-[11px] text-foreground'>
                  <pre className='whitespace-pre-wrap'>{content}</pre>
                </div>
              ) : activeSvg ? (
                <div
                  className='size-full max-h-full max-w-full flex items-center justify-center overflow-auto [&_svg]:max-w-full [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:h-auto [&_svg]:object-contain drop-shadow-sm'
                  dangerouslySetInnerHTML={{ __html: activeSvg }}
                />
              ) : (
                <div className='text-xs text-muted-foreground text-center'>
                  No preview available
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
