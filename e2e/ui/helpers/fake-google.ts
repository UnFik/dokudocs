import { createServer, type Server } from 'node:http'
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto'

// A stand-in for Google, for the end-to-end sign-in tests. The backend is started
// with GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL and GOOGLE_JWKS_URL pointing here (see
// test-e2e-with-backend in the Makefile).

export const FAKE_GOOGLE_PORT = 4399
const CLIENT_ID = 'e2e-client'
const CLIENT_SECRET = 'e2e-secret'

export type FakeIdentity = { sub: string; email: string; name: string; picture?: string }

const b64 = (value: Buffer | string) => Buffer.from(value).toString('base64url')

export class FakeGoogle {
  /** What the next person to sign in is; set it before clicking the button. */
  next: FakeIdentity | 'deny' = 'deny'
  private server?: Server
  private readonly key = generateKeyPairSync('rsa', { modulusLength: 2048 })
  private readonly codes = new Map<string, { identity: FakeIdentity; nonce: string }>()

  async start() {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${FAKE_GOOGLE_PORT}`)
      if (url.pathname === '/auth') return this.authorize(url, res)
      if (url.pathname === '/certs') return this.certs(res)
      if (url.pathname === '/token' && req.method === 'POST') return this.token(req, res)
      res.writeHead(404).end()
    })
    await new Promise<void>((resolve) => this.server!.listen(FAKE_GOOGLE_PORT, '127.0.0.1', resolve))
  }

  async stop() {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve())
  }

  private authorize(url: URL, res: import('node:http').ServerResponse) {
    const redirect = new URL(url.searchParams.get('redirect_uri') ?? '')
    redirect.searchParams.set('state', url.searchParams.get('state') ?? '')
    if (url.searchParams.get('client_id') !== CLIENT_ID || !url.searchParams.get('code_challenge')) {
      redirect.searchParams.set('error', 'invalid_request')
    } else if (this.next === 'deny') {
      redirect.searchParams.set('error', 'access_denied')
    } else {
      const code = randomUUID()
      this.codes.set(code, { identity: this.next, nonce: url.searchParams.get('nonce') ?? '' })
      redirect.searchParams.set('code', code)
    }
    res.writeHead(302, { Location: redirect.href }).end()
  }

  private certs(res: import('node:http').ServerResponse) {
    const jwk = this.key.publicKey.export({ format: 'jwk' })
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' })
    res.end(JSON.stringify({ keys: [{ ...jwk, kid: 'e2e-key', use: 'sig', alg: 'RS256' }] }))
  }

  private token(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const form = new URLSearchParams(body)
      const issued = this.codes.get(form.get('code') ?? '')
      if (!issued || form.get('client_secret') !== CLIENT_SECRET || !form.get('code_verifier')) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"invalid_grant"}')
        return
      }
      this.codes.delete(form.get('code') ?? '')
      const now = Math.floor(Date.now() / 1000)
      const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'e2e-key' }))
      const claims = b64(
        JSON.stringify({
          iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: issued.identity.sub,
          email: issued.identity.email, email_verified: true, name: issued.identity.name,
          picture: issued.identity.picture, nonce: issued.nonce, iat: now, exp: now + 600,
        }),
      )
      const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(this.key.privateKey).toString('base64url')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ access_token: 'unused', token_type: 'Bearer', id_token: `${header}.${claims}.${signature}` }))
    })
  }
}
