# DokuDocs testing plan

Status: implementation in progress; environment, seed, initial frontend/API tests, live smoke, and CI workflows are partially implemented.

This plan establishes a repeatable test environment and rolls out test coverage across the whole application. New and changed behavior must have appropriate tests. Existing gaps are closed incrementally, starting with access control, persistence, and document workflows.

The normative layer contracts and acceptance criteria are in the [testing specification](../specs/dokudocs-testing-spec.md).

## Current baseline

| Area | Current state | Plan consequence |
| --- | --- | --- |
| Backend | Go tests use the standard runner. Handler/usecase tests mostly use fakes; PostgreSQL repository, migration, and document-policy integration tests use the `integration` build tag and require `TEST_DATABASE_URL`. | Keep unit and PostgreSQL integration commands separate; integration tests fail when the explicit disposable database is unavailable. |
| Backend database | Development Compose remains persistent. A separate test Compose configuration now uses disposable PostgreSQL 16 with no named data volume. | Keep test targets isolated; add migration-upgrade corpus coverage before backfill/cutover. |
| Frontend | Bun, Vitest browser mode, and Chromium are already configured. Coverage currently excludes route files and UI primitives. | Reuse the installed stack; include feature page behavior in coverage, exercise navigation through E2E, and keep generated routing and shared UI primitives excluded. |
| E2E | Playwright has API tests and mocked UI tests, plus a live DBML persistence smoke. The default `make test-e2e` runs API tests only. | Keep smoke and full-suite commands explicit; replace DBML smoke with Markdown AST persistence when that route exists. |
| CI | `.github/workflows/ci.yml` runs backend checks, focused frontend browser tests, build, PR smoke, and nightly full E2E. Full lint/format/frontend suite are advisory against known repository baseline failures. | Confirm workflow on GitHub and reduce the baseline before making those three checks blocking. |

## Test environment

1. [x] Add backend/docker-compose.test.yaml for PostgreSQL 16 with no development DB, named persistent data volume, or fixed container name; each target uses an isolated Compose project and tears it down.
2. [x] Use an explicit TEST_DATABASE_URL in the destructive test-seed path; it refuses missing URLs and non-test database names.
3. Keep the test stack small. Do not start Redis until the application code under test requires it.
4. [x] Add a test-only seed path with the minimum stable admin login fixture; E2E resources are created by tests, not `make seed`.
5. [x] E2E Make targets run migrations/seed and start backend against the same disposable database as the browser/API suite.
6. Run migrations both from an empty database and from the schema immediately before the migration under test, with representative legacy documents for backfill checks.
7. Never use a production or developer database for CI, E2E, or destructive migration tests.

## Test commands and CI

Proposed commands reuse Go, Bun, Vitest, and Playwright already in the repository:

- **Backend unit:** make test-backend-unit runs database-free Go tests.
- **Backend integration:** make test-backend-integration starts or requires the disposable PostgreSQL environment and runs PostgreSQL-backed tests. Database-dependent Go tests use the integration build tag and require TEST_DATABASE_URL.
- **Backend aggregate:** make test-backend runs both backend targets.
- **Frontend:** retain bun run test and bun run test:coverage; CI also runs bun run lint, bun run format:check, and bun run build.
- **E2E smoke:** make test-e2e-smoke runs the tagged critical browser-to-backend journey.
- **E2E full:** make test-e2e-all runs the complete API and UI Playwright suites.

GitHub Actions workflow added at `.github/workflows/ci.yml`; current gates are:

| Trigger | Required checks |
| --- | --- |
| Pull request | Backend unit and integration tests; focused frontend domain/workspace browser tests and build; E2E smoke against the disposable test stack. Full frontend suite, lint, and formatting run advisory while their baseline is red. |
| Nightly schedule | Full API and UI E2E suites against a fresh test stack, plus backend and frontend checks. |

The CI setup pins Go through `backend/go.mod`, Bun to `1.3.14` from `frontend/package.json`, installs Chromium, applies migrations and the test seed through the Make targets, builds the frontend before Playwright starts Vite preview, and tears down the test Compose project. Screenshots and traces are retained on E2E failure.

Coverage starts with a recorded baseline. Once the baseline exists, CI blocks a pull request if coverage falls for a package changed by that pull request. Do not set a global percentage target. Use Go and Vitest reports; add only the small comparison needed to enforce the per-package baseline.

## Rollout phases

### T0 — Establish the baseline

- Record current Go, Vitest, API E2E, and UI E2E commands and coverage reports.
- Identify uncovered handlers, usecases, repositories, frontend features, and critical user flows.
- Reconcile `frontend/AGENTS.md` with `.github/workflows/ci.yml`; workflow exists but has not yet run on GitHub, and legacy lint/format/full-test steps remain advisory.

**Gate:** baseline report and test inventory are reviewable; no coverage percentage is treated as a quality target.

### T1 — Make the environment safe and repeatable

Status: partial; disposable Compose, explicit test seed, and smoke runner exist. Clean-install and upgrade migration corpus checks remain.

- Add disposable PostgreSQL Compose configuration, explicit test connection configuration, and the minimal test seed.
- Remove silent skips and the fallback to the development database from PostgreSQL integration tests.
- Add clean-install and upgrade migration checks.

**Gate:** tests cannot use the persistent development database; repeated runs start from clean state and tear it down.

### T2 — Complete backend layer coverage

- Keep handler tests at the HTTP boundary with httptest and fake usecases.
- Keep usecase tests focused on business rules with fake repositories and transaction outcomes.
- Expand query and repository tests against real PostgreSQL and actual migrations.
- Add tests for uncovered domains incrementally, prioritizing access policy, documents, workspaces, projects, then remaining handlers and usecases.

**Gate:** database-free unit tests run without services; PostgreSQL integration tests fail clearly when the test database is unavailable.

Progress (2026-09-28): document access-policy unit tests, usecase tests, and PostgreSQL repository/lifecycle integration tests cover the active G0 slice. `GOFLAGS=-p=1 make test-integration` passed after the Trash and `public_link` access changes.

### T3 — Complete frontend behavior coverage

- Add unit tests for pure functions and utilities.
- Add browser-mode tests for hooks, stores, forms, components, and feature pages using the existing Vitest browser setup and user-facing interactions.
- Expand coverage to feature page code; keep generated routing and shared UI primitives excluded, and verify routing through E2E.

**Gate:** feature behavior is covered without introducing another frontend test runner or browser dependency.

### T4 — Stabilize E2E and CI gates

Status: partial; commands and workflow exist. Current live smoke proves DBML metadata persistence, not the planned Markdown AST write/read path; GitHub execution is still pending.

- Preserve API E2E for backend journeys and UI E2E with mocked responses for isolated interface behavior.
- Add the live browser smoke path: sign in, open a workspace, create or edit a Markdown document, reload, and verify the saved content.
- Mark the smoke scenario explicitly so PR CI runs only the critical live flow; run the full API and UI suites nightly.
- Add GitHub Actions, publish failure artifacts, and verify that each job uses a fresh database.

**Gate:** PR gates cover the critical stack; nightly runs cover all existing API and UI journeys.

Progress (2026-09-28): `make test-e2e-api` passed 45/45, including public-link token versus internal access and Trash metadata visibility. The Markdown AST persistence smoke remains pending G2.

### T5 — Add AST/collaboration tests with each implementation gate

Use the acceptance cases in the specification and align them with the single G0–G5 execution plan in [refactor gap closure](dokudocs-refactor-gap-closure.md). Add a test before or with each implementation slice; do not wait until cutover. LTree tests apply only if the query/benchmark gate adopts it. Keep RAG tests in the later RAG phase.

**Gate:** no Markdown AST cutover, offline release, or RAG release until its relevant migration, projection, access, recovery, and end-to-end gates pass.

Progress (2026-09-28): G1 candidate Go Yjs merge has unit coverage using a synthetic JavaScript Yjs `Y.XmlFragment` update; tests cover cross-runtime XML state, duplicate retry idempotency, and malformed update rejection. The `Apply` seam tests that commit precedes fan-out, failed commits are not broadcast, duplicate commits are not rebroadcast, and fan-out failure preserves the durable receipt. Backend unit, targeted race, and disposable PostgreSQL integration suites passed. PostgreSQL collaboration persistence and browser/E2E paths are still pending.

Progress (2026-09-28): Added a versioned Muya Markdown corpus with four synthetic exact-byte fixtures and a browser-mode import/export round-trip test. The focused test passed; unsupported and opaque fixtures remain pending.

## Completion criteria

- Local and CI test runs use repeatable, disposable state and never share the development database.
- Unit, integration, browser, and E2E commands have clear, separate responsibilities.
- Pull requests run the required checks; the full suite runs nightly.
- Coverage baselines and per-package non-regression are enforced without a global percentage goal.
- Tests for each AST/LTree/collaboration capability are part of its implementation gate.

## Progress log

### 2026-09-28 — Initial repeatable environment and CI

- Selesai: disposable PostgreSQL Compose, explicit minimal test seed, root/backend Make targets, and PR/nightly workflow.
- Selesai: Vitest tests for domain API, dashboard hook, workspace dialog, and create-document behavior; E2E UI fixtures cover workspace/project/document APIs.
- Selesai: live smoke creates workspace and DBML document, then verifies the API returns it after local workspace cache is cleared.
- Verifikasi: `make test-backend` lulus termasuk disposable PostgreSQL integration; focused frontend domain/workspace tests 15/15 pada rerun; dashboard mocked E2E 4/4; live smoke 1/1; frontend build lulus.
- Ditemukan: satu focused frontend run mengalami Vitest dynamic-import failures, lalu rerun lulus; full `bun run format:check` juga gagal pada legacy formatting/decorator files.
- Belum: layer-by-layer backend coverage remains incremental; frontend full suite/lint/format baseline remains red; coverage baseline and CI per-package regression check are not configured; Markdown AST persistence smoke waits for G2.
- Next: add test cases with each G0/G1/G2 implementation slice, and run the new Actions workflow to catch hosted-runner differences.

### 2026-09-28 — G0 access-policy TDD slice

- Red: integration test proved missing document grant returned `ErrForbidden` while the policy expects `ErrAccessNotFound`; usecase test proved a document author without an owner grant could edit.
- Green: repository sentinel corrected; a shared domain policy now evaluates read/edit/suggest/decide/restore/permanent-delete; author and view/comment-only update attempts are denied.
- Verifikasi: PostgreSQL integration covers workspace-visible read and private-document denial through usecase + repository; `make test-integration` passes.
- Stabilitas: scoped the owner-grant failure constraint in the repository integration fixture to one UUID after package tests revealed interference under concurrent packages.
- Verifikasi race: revoke-first stale update ditolak; write-first test menahan update setelah row lock lalu membuktikan revoke menunggu update commit.
- Belum: lock/policy coverage across all access/lifecycle mutations and the complete handler/list/public matrix; all G1–G5 tests remain open.

### 2026-09-28 — G0 transactional access TDD slice

- Red: PostgreSQL integration showed the last document owner could remove their own owner grant.
- Green: access mutation preserves at least one direct owner; deleting or demoting the last owner is rejected, and transferring to a replacement owner first succeeds.
- Verifikasi: `make test-integration` lulus, termasuk stale-read update rejection after revoke.
- Green: both lock orderings pass in PostgreSQL integration; the write-first case uses a document-specific blocking trigger and observes PostgreSQL lock waits. Revoked editors are rejected by update, move, thumbnail, share-token, trash, restore, and permanent-delete paths; non-admin empty-trash is rejected; wrong-workspace move/restore/delete are rejected.
- Green: owners can still move, restore, permanently delete, and empty trash; the move test confirms the chosen project ID is stored. Create rejects non-members and inactive/cross-workspace projects.
- Verifikasi: `GOFLAGS=-p=1 make test-integration` lulus. `NODE_OPTIONS=--max-old-space-size=2048 make test-e2e-smoke` lulus 1/1; run tanpa heap cap sempat dihentikan SIGKILL sebelum Playwright mulai.
- Red/green handler: HTTP tests caught five document mutation handlers returning 500 for `ErrForbidden`/`ErrDocumentNotFound`; shared error mapping now returns 403/404, and the focused handler package passes.
- Verifikasi ulang: `GOFLAGS=-p=1 make test-integration` lulus setelah perubahan handler; `NODE_OPTIONS=--max-old-space-size=2048 make test-e2e-smoke` lulus 1/1.
- Belum: finish handler/list/public policy matrix and cover remaining read and metadata mutation paths required by G0.

### 2026-09-28 — G0 read/list/public TDD slice

- Red: HTTP test showed malformed `projectId` was silently ignored and returned 200; the handler now rejects it with 400.
- Handler unit coverage: document endpoint tests exercise usecase error mapping across every document handler, including hidden public-link failures.
- Usecase coverage: list requires workspace membership and forwards the caller scope/filter; public-link access trims tokens and rejects draft or non-public records returned by a permissive repository.
- API E2E: member list/detail checks cover private no-grant, active view grant, draft view denial, and draft edit access. Public draft token returns 404; active public link returns 200.
- Test environment fix: API E2E user factory now uses a password meeting the current 15-character registration minimum.
- Verifikasi: `GOFLAGS=-p=1 make test-integration` passes; focused API E2E access matrix and document lifecycle each pass 1/1; full `make test-e2e-api` passes 44/44.
- Red/green metadata repository tests showed direct `RecordView` and `ToggleStar` writes bypassed current read access; both now use the ADR 0011 transaction lock path and deny private no-grant writes without side effects. Authorized view grants still work.
- Added private workspace-admin read assertions and private-project visibility E2E: workspace override is visible to members, inherited private-project content appears only after project viewer membership is added.
- Verifikasi ulang: full PostgreSQL integration and `make test-e2e-api` pass 44/44 after metadata authorization changes.
- Belum: G0 still needs the full role/project/visibility matrix across every read consumer and remaining metadata paths; G1–G5 remain open.
