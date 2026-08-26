import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MermaidPreview } from './previews/mermaid-preview'
import { UnifiedMonacoEditor } from './unified-monaco-editor'

interface MermaidEditorProps {
  docId?: string
  content: string
  onChange: (newContent: string) => void
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

export function MermaidEditor({ docId, content, onChange }: MermaidEditorProps) {
  const [showTemplatesModal, setShowTemplatesModal] = useState(false)

  const handleSelectTemplate = (templateCode: string) => {
    onChange(templateCode)
    setShowTemplatesModal(false)
    toast.success('Template loaded into editor')
  }

  const customActions = (
    <>
      <Button
        variant='ghost'
        size='sm'
        onClick={() => setShowTemplatesModal(true)}
        className='h-6 gap-1 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground'
        title='Insert Mermaid Template'
      >
        <Sparkles className='size-3 text-purple-500' />
        <span>Templates</span>
      </Button>

      <Dialog open={showTemplatesModal} onOpenChange={setShowTemplatesModal}>
        <DialogContent className='sm:max-w-2xl max-h-[85vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle className='text-base font-bold flex items-center gap-2'>
              <Sparkles className='size-4 text-purple-500' />
              <span>Insert Mermaid Template</span>
            </DialogTitle>
            <DialogDescription className='text-xs'>
              Select a pre-configured architecture or sequence diagram template
            </DialogDescription>
          </DialogHeader>

          <div className='grid grid-cols-1 sm:grid-cols-2 gap-3 py-3'>
            {MERMAID_TEMPLATES.map((tmpl) => (
              <div
                key={tmpl.name}
                onClick={() => handleSelectTemplate(tmpl.code)}
                className='flex flex-col justify-between p-3 rounded-lg border border-border/80 bg-muted/20 hover:border-purple-500/60 hover:bg-purple-500/5 transition-all cursor-pointer group'
              >
                <div>
                  <div className='flex items-center justify-between mb-1.5'>
                    <span className='text-xs font-bold text-foreground group-hover:text-purple-600 dark:group-hover:text-purple-400'>
                      {tmpl.name}
                    </span>
                    <span className='text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 font-mono font-medium'>
                      {tmpl.category}
                    </span>
                  </div>
                  <p className='text-[11px] text-muted-foreground line-clamp-2 mb-3'>
                    {tmpl.description}
                  </p>
                </div>
                <Button
                  size='sm'
                  variant='outline'
                  className='w-full text-xs h-7 group-hover:bg-purple-500 group-hover:text-white group-hover:border-purple-500 transition-colors'
                >
                  Use Template
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )

  return (
    <UnifiedMonacoEditor
      docId={docId}
      content={content}
      onChange={onChange}
      language='mermaid'
      previewContent={<MermaidPreview docId={docId} content={content} />}
      customToolbarActions={customActions}
    />
  )
}
