# Deployment

Every push to `main` deploys to the production server. The `Deploy` workflow
(`.github/workflows/deploy.yml`) has two jobs:

1. **images**, on GitHub: builds the `api` (also used by `migrate`), `collab`
   and `frontend` images and pushes them to GHCR as
   `ghcr.io/unfik/dokudocs-<name>:src-<hash>`. The hash comes from what goes
   into that image (`scripts/deploy/image-tags.sh`): the `backend` or
   `frontend` folder, or for `collab` its folder plus the frontend files its
   Dockerfile copies. An image already pushed for the same sources is not
   built again.
2. **deploy**, on the runner that lives on the server: runs
   `sudo /usr/local/bin/dokudocs-deploy <SHA>`.

`dokudocs-deploy` checks that the commit is on `origin/main`, checks it out in
`/opt/dokudocs`, and runs that commit's `scripts/deploy/deploy.sh`, which:

- pulls the commit's images,
- dumps the database to `/var/backups/dokudocs/` (the last 10 are kept), since
  migrations only go forward,
- runs `docker compose up -d --no-build` with the same files `make build` uses
  (`OBSERVABILITY` in `.env` decides on `docker-compose.observability.yaml`).
  Only services whose image tag changed are replaced; the rest keep running,
- waits for `/api/v1/health` and `/sign-in` through nginx, and writes the
  commit to `/opt/dokudocs/.deployed`.

The server builds nothing: it has about 2 GB of memory. Deploys run one at a
time.

## Downtime

Measured on a local copy of the stack, probing every 0.2 s:

| What changed | Replaced | Down |
|---|---|---|
| backend only | `api` | the API for about 1 s; pages keep loading |
| everything | `api`, `collab`, `frontend` | the site for about 10 s |

Health checks run every second while a container starts, so the next service
starts as soon as the one before is ready. nginx looks `api` and `collab` up
again as they are replaced, so it can keep running. Open editors reconnect
whenever `collab` is replaced.

Pull request CI is the only test gate: a merge to `main` deploys without
waiting for another run.

## Signing in and email

Google sign-in needs, in `/opt/dokudocs/.env`:

```dotenv
PUBLIC_APP_URL=https://<the public address, no trailing slash>
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

The OAuth client in Google Cloud Console (Google Auth Platform → Clients, a
*Web application*) must list `https://<address>` as an authorized JavaScript
origin and `https://<address>/api/v1/auth/google/callback` as the redirect URI.
The API builds that callback from `PUBLIC_APP_URL`, so the two cannot differ. With
either credential empty the server still starts and `Continue with Google`
answers 503.

Verification emails go out over SMTP (STARTTLS on port 587; port 465 is not
supported):

```dotenv
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=Dokudocs <no-reply@<your domain>>
```

Add SPF and DKIM records for the sending domain at the DNS provider, or the mail
lands in spam. `make dev` starts Mailpit instead; read its mail at
http://localhost:8025.

`REQUIRE_EMAIL_VERIFICATION` closes the app to a User whose email is not
verified (ADR-0035). It is off by default, and the API refuses to start with it
on and no `SMTP_HOST` and `SMTP_FROM`. Existing accounts are not marked verified,
so turning it on sends every one of them through the verification page. Turn it
on in this order:

1. Deploy with the flag off and SMTP filled in.
2. Register a test account and check that the email arrives and the link works.
3. Set `REQUIRE_EMAIL_VERIFICATION=true` and run `make build` (or the Deploy workflow).

Workspace invitations are email too: with no `SMTP_HOST` and `SMTP_FROM`, inviting
someone answers 503 and nothing is stored (ADR-0036). `RATE_LIMIT_INVITE_SEND_PER_MIN`
(default 10) limits sending and sending again, and `RATE_LIMIT_INVITE_LOOKUP_PER_MIN`
(default 30) limits opening and accepting a link.

Sign-in endpoints are limited per client address (`RATE_LIMIT_LOGIN_PER_MIN`,
`RATE_LIMIT_GOOGLE_START_PER_MIN`, `RATE_LIMIT_GOOGLE_CALLBACK_PER_MIN`; `0` turns
one off). The counters live in the API process, so they hold for one API
instance: with more than one, put the limit in front, for example a Cloudflare
rate rule on `/api/v1/auth/`. The client address comes from `X-Real-IP`, which
nginx sets, and is trusted only with `TRUST_PROXY_HEADERS=true` (set in
`docker-compose.yaml`, where nginx is the only way in).

## AI provider

The chatbot's answer and embedding models, base URLs, protocol and API keys live in
the database, not in `.env`. A Superadmin changes them under **Platform → AI**
(`/platform/ai`), and the change applies within about 30 seconds without a restart
([ADR-0038](adr/0038-ai-provider-settings-live-in-the-database-with-an-encrypted-key.md)).

- `AI_SETTINGS_ENCRYPTION_KEY` is **required**: the API server refuses to start
  without it, and `docker-compose.yaml` fails to start with it unset. Generate one
  with `openssl rand -base64 32` and keep it with the other secrets. It seals the
  API keys stored in the database. There is no rotation: if the key is lost or
  replaced, a Superadmin enters the API keys again.
- `OPENAI_API_KEY`, `RAG_ANSWER_MODEL` and `RAG_EMBEDDING_MODEL` only seed an empty
  table on the first boot. After that the database wins and changing them in `.env`
  does nothing.
- If the provider fails, the chatbot says the AI service is unavailable and the
  Platform → AI page shows the last error. It does not fall back to `.env`.
- `AI_ALLOW_PRIVATE_HOSTS=true` lets a Superadmin use a base URL on a private or local
  address (for example a model server in the same Docker network). Leave it `false`
  on a server that reaches internal services.
- Changing the embedding model re-embeds every document in the background. The old
  model keeps answering until the last document is done, then the old vectors are
  deleted ([ADR-0039](adr/0039-embedding-model-switch-keeps-the-old-model-active-until-re-embedding-finishes.md)).
  Only 1536-dimension models are accepted.
- A user becomes a Superadmin through the `superadmin` role in `user_roles`; the
  seeder gives it to the admin user. Nothing in the UI grants it.

## AI agent and MCP

The assistant can act, not only answer, once a Superadmin sets an **Agent** model
under **Platform → AI** (a third setting next to Answer and Embedding). The model
must support tool calling: the connection test asks it to call a tool and refuses
the save if it does not. Without an agent model, chat answers from documents as
before.

- What the assistant may do for a User is the User's **AI permissions** (Settings →
  AI and MCP), intersected with the User's own access to each document or project
  ([ADR-0044](adr/0044-ai-permissions-are-one-set-per-user-intersected-with-document-access.md)).
  Only reading is on until the User changes it. Deleting projects, permanent
  deletion, emptying the trash, public links, sharing and workspace settings are
  never available to AI.
- In Dokudocs chat, Markdown edits become suggestions labelled **AI assisted**, and
  every other change waits for the User to approve it in the chat. Through MCP, an
  editor's edit goes straight into the body after a named version is saved
  ([ADR-0043](adr/0043-agent-writes-follow-the-users-own-document-rights.md)).
  Content edits go through the collaboration service (`/internal/agent-read` and
  `/internal/agent-edit`, behind `COLLAB_SERVICE_SECRET`), so `COLLAB_SERVICE_URL`
  must reach it from the API.
- Outside AI apps connect to **`/api/v1/mcp`** (Streamable HTTP) with a User's
  **MCP key** in `Authorization: Bearer <key>`
  ([ADR-0045](adr/0045-mcp-api-keys-belong-to-a-user-not-a-workspace.md)). The
  `/api` proxy rule already reaches it. A key reaches every workspace its owner is
  in, with the owner's access, and may never expire; its owner can revoke it.
- **Platform → MCP** holds the switch that stops every key, the per-key read and
  write limits per minute, the largest tool result, and how many days of call
  history to keep (pruned hourly). The limits are counted per API instance.
- **Platform → Skills** holds instructions every User calls with `/name` in chat;
  MCP apps see them as prompts. A skill never adds access.
- **Platform → Model usage** shows tokens per day, model, use and User for the
  Dokudocs models. MCP apps use their own models and are not counted. Its
  **Usage limits** section sets how many tokens one User may use in one workspace
  per calendar month (reset on the 1st, UTC), by the workspace's Plan. The limits
  live in the `ai_plan_limits` table; a Plan with no row gets the **Free** limit.
  A migration seeds `Free` 300,000, `Pro` 3,000,000 and `Business` 15,000,000:
  change them, and add a row for every Plan name the billing provider will set,
  before launch.
  A spent limit refuses new questions with `429` and code `ai_limit_reached`; a
  run already going finishes, so use can pass the limit by one run.
- **Chats** carry more than a question. A User can narrow a workspace question to
  categories, bring up to 2 of their own chats as background, and attach up to 5
  text files (`.txt`, `.md`, `.csv`, `.tsv`, `.json`, `.log`; 200,000 characters in
  all) to one question. Files are read by the browser, sent with the question and
  never stored as documents; PDF is not supported. After a chat's first answer
  the answer model writes its title, which counts toward the limit.

## Rolling back

Run the `Deploy` workflow by hand (Actions → Deploy → Run workflow, on `main`)
with the commit to go back to. Its images are reused, nothing is built. The
database is not rolled back: an older commit runs against the newer schema.
If that is not safe, restore the dump taken before the bad deploy.

## Setting up the server

Once, as root on the server, with a runner registration token
(Settings → Actions → Runners → New self-hosted runner, or
`gh api -X POST repos/UnFik/dokudocs/actions/runners/registration-token -q .token`):

```bash
cd /opt/dokudocs && git pull
bash scripts/deploy/setup-server.sh <token>
```

It adds a `github-runner` user that is not in the `docker` group and may run
only `dokudocs-deploy` as root, and installs the runner as a service with the
label `dokudocs-production`.

The repository is public, and a fork's pull request could ask for this runner.
Keep **Settings → Actions → General → Fork pull request workflows** on
*Require approval for all external contributors*, and never approve a run
that touches `.github/workflows`.

`make build` on the server still builds the images there, for a fix that
cannot wait for CI.
