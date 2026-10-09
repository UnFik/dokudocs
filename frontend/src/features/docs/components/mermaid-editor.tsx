import { useMemo, useRef, useState } from 'react'
import { LayoutTemplate } from 'lucide-react'
import { toast } from 'sonner'
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
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { SourceBinding } from '../lib/source-binding'
import { MermaidPreview } from './previews/mermaid-preview'
import { UnifiedMonacoEditor, type SourceCollab } from './unified-monaco-editor'

interface MermaidEditorProps {
  docId?: string
  content: string
  onChange: (newContent: string) => void
  /** Edited together: the editor writes the shared source, and `content` is its preview. */
  collab?: SourceCollab
}

const MERMAID_TEMPLATES = [
  {
    name: 'Sequence API Authentication Flow',
    description: 'OAuth2 / HMAC authentication request & response sequence',
    category: 'Sequence Diagram',
    code: `sequenceDiagram
    autonumber
    participant App as Elysia Application
    participant RestClient as TuyaRestClient
    participant Tuya as Tuya OpenAPI

    Note over App, RestClient: 1. Get Access Token (If expired or empty)
    RestClient->>RestClient: Generate SHA256 of empty body -> bodyHash
    RestClient->>RestClient: stringToSign = "GET\\n" + bodyHash + "\\n\\n/v1.0/token?grant_type=1"
    RestClient->>RestClient: payload = clientID + "" + timestamp + stringToSign
    RestClient->>RestClient: signature = HMAC-SHA256(payload, secret).toUpperCase()
    RestClient->>Tuya: GET /v1.0/token?grant_type=1
    Note over RestClient, Tuya: Headers:<br/>client_id: accessId<br/>t: timestamp<br/>sign_method: HMAC-SHA256<br/>sign: signature<br/>Content-Type: application/json
    Tuya-->>RestClient: 200 OK (access_token, expire_time)

    Note over App, Tuya: 2. Execute Authenticated API Request
    App->>RestClient: request(method, path, body, query)
    RestClient->>RestClient: Generate SHA256 of JSON body -> bodyHash
    RestClient->>RestClient: stringToSign = method + "\\n" + bodyHash + "\\n\\n" + path + query
    RestClient->>RestClient: payload = clientID + token + timestamp + stringToSign
    RestClient->>RestClient: signature = HMAC-SHA256(payload, secret).toUpperCase()
    RestClient->>Tuya: HTTP [method] path + query
    Note over RestClient, Tuya: Headers:<br/>client_id: accessId<br/>t: timestamp<br/>sign_method: HMAC-SHA256<br/>sign: signature<br/>access_token: token<br/>Content-Type: application/json
    Tuya-->>RestClient: Response JSON
    RestClient-->>App: Return Decoded Data
`,
  },
  {
    name: 'Microservices Flowchart',
    description: 'Decision logic, caching layers, and database interactions',
    category: 'Flowchart',
    code: `flowchart TD
    Client([Web & Mobile Client]) --> CDN[Cloudflare CDN]
    CDN --> Gateway[API Gateway / Ingress]

    subgraph CoreServices [Microservices Core]
        Gateway --> Auth[Auth Service]
        Gateway --> Order[Order Service]
        Gateway --> Payment[Payment Gateway]
    end

    subgraph DataTier [Storage & Cache]
        Order --> Redis[(Redis Cache)]
        Order --> PG[(PostgreSQL Primary)]
        PG -. Replica .-> PGReplica[(Read Replica)]
    end

    Payment --> StripeAPI[Stripe Webhook API]
`,
  },
  {
    name: 'E-Commerce Domain Model',
    description: 'Class hierarchy, composition, and domain entities',
    category: 'Class Diagram',
    code: `classDiagram
    class User {
        +String id
        +String email
        +String role
        +login() bool
    }
    class Order {
        +String orderId
        +Float totalAmount
        +String status
        +checkout()
    }
    class Product {
        +String sku
        +String name
        +Float price
        +isInStock() bool
    }
    User "1" *-- "*" Order : places
    Order "1" o-- "*" Product : contains
`,
  },
  {
    name: 'Git Feature Branching',
    description: 'Branch merges, release tags, and cherry-picks',
    category: 'Git Graph',
    code: `gitGraph
    commit id: "Initial Commit"
    commit id: "Setup Router"
    branch develop
    checkout develop
    commit id: "Add Auth Store"
    branch feature/mermaid
    checkout feature/mermaid
    commit id: "Implement Live Preview"
    commit id: "Add IntelliSense"
    checkout develop
    merge feature/mermaid tag: "v1.1-preview"
    checkout main
    merge develop tag: "v1.1.0"
`,
  },
]

export function MermaidEditor({
  docId,
  content,
  onChange,
  collab,
}: MermaidEditorProps) {
  const [showTemplatesModal, setShowTemplatesModal] = useState(false)
  // A template waiting for the person to confirm it replaces the shared source.
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null)
  const bindingRef = useRef<SourceBinding | null>(null)
  const shared = useMemo<SourceCollab | undefined>(
    () =>
      collab && {
        ...collab,
        onBinding: (binding) => {
          bindingRef.current = binding
          collab.onBinding?.(binding)
        },
      },
    [collab]
  )

  const applyTemplate = (templateCode: string) => {
    if (shared) bindingRef.current?.replace(templateCode)
    else onChange(templateCode)
    toast.success('Template loaded into editor')
  }

  const handleSelectTemplate = (templateCode: string) => {
    setShowTemplatesModal(false)
    // Everyone editing sees the template replace the diagram, so ask first.
    if (shared && shared.text.length > 0) setPendingTemplate(templateCode)
    else applyTemplate(templateCode)
  }

  const customActions = (
    <>
      <Button
        variant='ghost'
        size='sm'
        onClick={() => setShowTemplatesModal(true)}
        disabled={collab?.readOnly}
        className='h-6 gap-1 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground'
        title='Insert Mermaid Template'
      >
        <LayoutTemplate className='size-3 text-muted-foreground' />
        <span>Templates</span>
      </Button>

      <Dialog open={showTemplatesModal} onOpenChange={setShowTemplatesModal}>
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2 text-base font-bold'>
              <LayoutTemplate className='size-4 text-muted-foreground' />
              <span>Insert Mermaid Template</span>
            </DialogTitle>
            <DialogDescription className='text-xs'>
              Select a pre-configured architecture or sequence diagram template
            </DialogDescription>
          </DialogHeader>

          <div className='grid grid-cols-1 gap-3 py-3 sm:grid-cols-2'>
            {MERMAID_TEMPLATES.map((tmpl) => (
              <div
                key={tmpl.name}
                onClick={() => handleSelectTemplate(tmpl.code)}
                className='group flex cursor-pointer flex-col justify-between rounded-lg border border-border/80 bg-muted/20 p-3 transition-all hover:border-input hover:bg-accent'
              >
                <div>
                  <div className='mb-1.5 flex items-center justify-between'>
                    <span className='text-xs font-bold text-foreground'>
                      {tmpl.name}
                    </span>
                    <span className='rounded-sm bg-border px-1.5 py-0.5 font-mono text-[9px] font-medium text-foreground'>
                      {tmpl.category}
                    </span>
                  </div>
                  <p className='mb-3 line-clamp-2 text-[11px] text-muted-foreground'>
                    {tmpl.description}
                  </p>
                </div>
                <Button
                  size='sm'
                  variant='outline'
                  className='h-7 w-full text-xs transition-colors group-hover:bg-primary group-hover:text-primary-foreground'
                >
                  Use Template
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingTemplate !== null}
        onOpenChange={(open) => !open && setPendingTemplate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the diagram?</AlertDialogTitle>
            <AlertDialogDescription>
              The template replaces the source for everyone editing this
              document. You can undo it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep diagram</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingTemplate !== null) applyTemplate(pendingTemplate)
                setPendingTemplate(null)
              }}
            >
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )

  return (
    <UnifiedMonacoEditor
      docId={docId}
      collab={shared}
      content={content}
      onChange={onChange}
      language='mermaid'
      previewContent={<MermaidPreview docId={docId} content={content} />}
      customToolbarActions={customActions}
    />
  )
}
