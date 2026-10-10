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

Sign-in endpoints are limited per client address (`RATE_LIMIT_LOGIN_PER_MIN`,
`RATE_LIMIT_GOOGLE_START_PER_MIN`, `RATE_LIMIT_GOOGLE_CALLBACK_PER_MIN`; `0` turns
one off). The counters live in the API process, so they hold for one API
instance: with more than one, put the limit in front, for example a Cloudflare
rate rule on `/api/v1/auth/`. The client address comes from `X-Real-IP`, which
nginx sets, and is trusted only with `TRUST_PROXY_HEADERS=true` (set in
`docker-compose.yaml`, where nginx is the only way in).

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
