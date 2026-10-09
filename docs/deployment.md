# Deployment

Every push to `main` deploys to the production server. The `Deploy` workflow
(`.github/workflows/deploy.yml`) has two jobs:

1. **images**, on GitHub: builds the `api` (also used by `migrate`), `collab`
   and `frontend` images and pushes them to GHCR as
   `ghcr.io/unfik/dokudocs-<name>:<commit SHA>` (and `:main`).
2. **deploy**, on the runner that lives on the server: runs
   `sudo /usr/local/bin/dokudocs-deploy <SHA>`.

`dokudocs-deploy` checks that the commit is on `origin/main`, checks it out in
`/opt/dokudocs`, and runs that commit's `scripts/deploy/deploy.sh`, which:

- pulls the commit's images,
- dumps the database to `/var/backups/dokudocs/` (the last 10 are kept), since
  migrations only go forward,
- runs `docker compose up -d --no-build` with the same files `make build` uses
  (`OBSERVABILITY` in `.env` decides on `docker-compose.observability.yaml`),
- waits for `/api/v1/health` and `/sign-in` through nginx, and writes the
  commit to `/opt/dokudocs/.deployed`.

The server builds nothing: it has about 2 GB of memory. Deploys run one at a
time. Open editors reconnect after `api` and `collab` restart.

Pull request CI is the only test gate: a merge to `main` deploys without
waiting for another run.

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
