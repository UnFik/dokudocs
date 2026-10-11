// Puts a registered person into a workspace the way a real one gets in: the
// owner invites the address, the person verifies it and opens the mailed link.
// The API under test sends its mail to Mailpit; MAILPIT_URL says where to read it.

type Options = {
  apiURL?: string
  /** Authorization header value of an owner or admin of the workspace. */
  authorization: string
  workspaceId: string
  email: string
  role?: 'member' | 'admin'
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function mailpitURL() {
  const url = process.env.MAILPIT_URL
  if (!url) throw new Error('MAILPIT_URL is not set: run the E2E suite through `make test-e2e-*`')
  return url.replace(/\/$/, '')
}

/** Text of the newest mail to `email` that holds a link to `path`; waits for it. */
export async function mailedToken(email: string, path: 'invite' | 'verify-email', since = 0): Promise<string> {
  const pattern = new RegExp(`/${path}\\?token=([A-Za-z0-9_-]+)`)
  const base = mailpitURL()
  for (let attempt = 0; attempt < 50; attempt++) {
    const found = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
    const { messages = [] } = (await found.json()) as { messages?: { ID: string; Created: string }[] }
    for (const { ID, Created } of messages.filter((m) => Date.parse(m.Created) >= since)) {
      const mail = (await (await fetch(`${base}/api/v1/message/${ID}`)).json()) as { Text: string }
      const match = pattern.exec(mail.Text)
      if (match) return match[1]
    }
    await sleep(100)
  }
  throw new Error(`no ${path} mail reached ${email}`)
}

export async function inviteToWorkspace({ apiURL = process.env.API_URL || 'http://localhost:8080', authorization, workspaceId, email, role = 'member' }: Options) {
  const sentAfter = Date.now() - 2000
  const invited = await fetch(`${apiURL}/api/v1/workspaces/${workspaceId}/invites`, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  })
  if (invited.status !== 201) throw new Error(`invite ${email}: ${invited.status} ${await invited.text()}`)
  return mailedToken(email, 'invite', sentAfter)
}

/** Invites `email` and accepts as that person. Returns the person's verified access token. */
export async function joinWorkspace(options: Options): Promise<string> {
  const apiURL = options.apiURL ?? (process.env.API_URL || 'http://localhost:8080')
  const inviteToken = await inviteToWorkspace(options)
  const json = { 'Content-Type': 'application/json' }
  const verified = await fetch(`${apiURL}/api/v1/auth/email/verify`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ token: await mailedToken(options.email, 'verify-email') }),
  })
  if (!verified.ok) throw new Error(`verify ${options.email}: ${verified.status} ${await verified.text()}`)
  const accessToken = ((await verified.json()) as { data: { accessToken: string } }).data.accessToken
  const accepted = await fetch(`${apiURL}/api/v1/invites/accept`, {
    method: 'POST',
    headers: { ...json, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ token: inviteToken }),
  })
  if (!accepted.ok) throw new Error(`accept for ${options.email}: ${accepted.status} ${await accepted.text()}`)
  return accessToken
}
