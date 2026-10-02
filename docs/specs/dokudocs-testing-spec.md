# DokuDocs testing specification

Status: accepted specification for implementation.

The [testing plan](../plans/dokudocs-testing-plan.md) defines environment setup, CI, and rollout. This document defines what each test layer must prove. These criteria apply to the existing application and extend with the AST/LTree and collaboration work.

## Test layer contracts

| Layer | Test type and boundary | Required behavior |
| --- | --- | --- |
| Backend handler | Unit; httptest with a fake usecase | Check request decoding and validation, path/context extraction, response envelope and status mapping, and usecase errors. Do not call PostgreSQL. |
| Backend usecase | Unit; fake repositories and transaction boundary | Check success, authorization denial, not-found and dependency errors, state changes, and rollback/commit behavior. Do not depend on HTTP or PostgreSQL. |
| Backend query/repository | Integration; disposable PostgreSQL using real migrations | Check query results and scanning, no-row behavior, constraints, parameterized filters, tenant boundaries, and transaction effects. Do not mock SQL or silently skip when PostgreSQL is unavailable. |
| Backend routes and middleware | Unit or integration at the registered HTTP boundary | Check route registration, authentication, workspace context, and middleware order where they affect access decisions. |
| Frontend pure functions and utilities | Unit with Vitest | Check inputs, outputs, boundary cases, and errors without rendering React. |
| Frontend hooks, stores, forms, components, and feature pages | Browser-mode tests with Vitest, Chromium, and the existing browser React helpers | Assert visible behavior and state transitions through accessible roles and user interactions. Mock network boundaries when testing UI behavior alone. |
| API E2E | Playwright against a live backend and disposable database | Check the externally visible API lifecycle and access rules across authentication, workspaces, projects, documents, sharing, and trash. |
| UI E2E | Playwright against the built frontend | Use mocked API responses for broad UI behavior. Keep a small live smoke flow that reaches the actual backend and database. |

Unit tests must be deterministic and independent of test order. PostgreSQL integration tests use the integration build tag, require TEST_DATABASE_URL, and fail if the database cannot be reached. Tests use unique fixtures and clean up their own database writes or run inside a rolled-back transaction where the operation permits it.

The development seed is not a test fixture. The test seed contains only stable authentication prerequisites; each test creates the users and resources it needs. The disposable database is removed after the run, so test records cannot accumulate in the developer database.

## Frontend coverage scope

- Include business logic and page behavior in src/features/**, utilities, hooks, and stores.
- Exclude generated route-tree code, test utilities, assets, and shared UI primitives from the line-coverage denominator.
- Exclude thin src/routes/** declarations from line coverage; exercise route loading, guards, and navigation through browser E2E.
- Use Vitest browser mode and the configured Chromium provider. Do not add another test runner or browser matrix in the initial rollout.

## Pull request and scheduled gates

Pull request CI currently blocks on backend unit and PostgreSQL integration tests, focused frontend domain/workspace browser tests, frontend build, and the live E2E smoke scenario. Frontend lint and format checks and the full browser suite are advisory while the recorded baseline failures remain. The current live smoke proves workspace and DBML persistence; it does not yet prove Markdown AST persistence. After G2 backfill/cutover support is available in the disposable test environment, replace or extend that smoke with sign in → open workspace → create/edit Markdown through AST/Yjs → reload → verify body and Markdown export.

Nightly CI runs the full API and UI E2E suites plus backend and frontend checks. The UI suite includes mocked interface journeys and live integration cases. Failures retain a screenshot and trace.

Coverage reports establish the initial baseline. After baseline adoption, a changed package must not fall below its baseline. Do not impose a global coverage percentage. Update the baseline only as a reviewed change when the measured source scope changes intentionally.

## Migration and application acceptance cases

### Access policy and ordinary application behavior

- Exercise handler and usecase behavior for allowed and denied reads/writes, including workspace, project, and document boundaries.
- Exercise query behavior against real PostgreSQL for visibility, grants, membership, trash, and tenant filters.
- Keep existing API lifecycle coverage for auth, user settings/search, workspace membership, project categories/members, document CRUD/search/share/access/trash, and add missing cases as the legacy test inventory is closed.
- Verify that public-link access follows its explicit policy and does not expose private workspace data.

### Schema migration and data compatibility

- Apply all migrations from an empty PostgreSQL database.
- For a migration that changes stored document bodies, build the prior schema, insert representative legacy Markdown documents, then apply the pending migrations.
- Maintain a versioned, repository-owned synthetic Markdown corpus derived from supported Muya syntax tests. Do not use backup document contents as fixtures. Classify each fixture as exact-byte round-trip or opaque-source preservation.
- Compare imported and exported Markdown; preserve syntax that cannot be represented exactly as opaque source, or block cutover for a mismatch.
- Verify that non-Markdown document types remain readable and unchanged by Markdown migrations.
- Verify that every current body reader uses the migrated source or a deliberate compatibility read; stale Markdown in documents.content must not silently appear as current content.

### AST and LTree

- Cover Markdown parsing/export round trips for supported syntax, stable node identity, empty documents, nested structures, opaque source bytes, and root `trailingWhitespace`/`sourceGaps`/`sourceTables` metadata through ProseMirror/Yjs projection. Editing a table cell must make the exporter use current AST content rather than preserved source bytes.
- Verify each initialized Markdown body has exactly one same-document root with no parent; node-level move/delete cannot remove it, and deleting all content leaves a valid empty root. Import/restore may replace the root only through their atomic whole-body commands.
- Verify that insert, sibling reorder, reparent, and subtree moves keep `parent_id` and relative sibling order consistent. These relational fields are canonical; a client-supplied path is never authoritative.
- Before adopting LTree, name a product query that needs subtree lookup and compare its query plan and representative latency with a recursive `parent_id` query. If LTree is adopted, also verify path invariants after migration, restart, and restore.
- Verify that backfill reports every mismatch and never silently drops source content.

### Collaborative state and structural commands

- Project updates between Yjs state and AST, persist them, restart the process, and verify both representations converge to the same body version and epoch.
- Apply duplicate updates and reconnect after a missed fan-out message; durable PostgreSQL state remains authoritative and clients recover version gaps.
- Attempt a Yjs update that reparents/reorders an existing node or deletes an existing node without a matching command; reject it without state commit, version bump, ACK, or broadcast. `DeleteNode` also rejects the root. Matching `MoveNode`/`DeleteNode` commands update Yjs and AST atomically.
- Commit a MoveNode receipt in the same transaction as the move. Retry with the same document, epoch, actor, command ID, and request fingerprint returns the stored result without applying a second move.
- Reject reuse of a command ID with a different actor, epoch, or request fingerprint. An accepted no-op has a receipt without incrementing body version. A move rejected before commit has no receipt.
- Reject reuse of the same document command ID across `MoveNode` and `DeleteNode`; the semantic request hash binds the command kind.
- Simulate a committed move whose ACK is lost, restore to a new epoch, then retry the identical command. Receipt lookup happens after current access is checked and before epoch validation; return the original receipt without replaying the move.
- Commit a structural MoveNode and verify AST/Yjs, `body_version`, `body_epoch`, and receipt change atomically; an old-epoch update stays pending/stale, while a no-op move and receipt retry do not increment the epoch.
- Accept a Suggestion that moves an existing node; verify the same MoveNode validation, one atomic `body_epoch` increment with the body/status commit, and no repeat mutation or epoch increment on retry.
- Retry create/duplicate with the same actor, operation, request ID, and fingerprint; return the same document. Reusing that key with a different payload is rejected. A different actor's identical request ID is an independent key and must never expose the first actor's result. Retry an identical import as a no-op; reject an import whose base body version is stale and whose source fingerprint differs.
- Run concurrent identical create/duplicate requests with the same actor/key; exactly one document commits and both callers receive its ID, with no orphan document or missing owner grant.

### Opaque Markdown nodes

- Before committing a merged update, compare projected opaque nodes against the committed AST.
- Reject the transaction if an opaque node is deleted, its source bytes or identity/type changes, or its parent/order path changes directly or through an ancestor move.
- The rejection produces no durable state update, ACK, or broadcast.
- Accept edits to ordinary nodes and insertion/removal of ordinary siblings when opaque identity, bytes, and structural path remain unchanged.
- Test explicit ImportMarkdown and RestoreRevision as separate whole-body replacement operations with their own round-trip validation.

### Collaboration access and offline recovery

- Reauthorize every WebSocket connection and reconnect. A user whose access was revoked cannot send a durable update.
- Race a durable edit against workspace membership removal, project membership/visibility change, document grant removal, and document visibility/trash mutation. If revoke commits first, the edit and every subsequent WebSocket update is rejected without ACK; if the edit acquires the access locks first, it commits before revoke.
- Test two clients against separate backend instances: missed Redis fan-out is recovered by version-gap detection and PostgreSQL state.
- Exercise the browser JavaScript Yjs client against the registered Go WebSocket route and PostgreSQL: commit precedes ACK, browser updates survive reconnect/restart, and a second client receives or resyncs the committed body. Run Hocuspocus comparison only if the Go correctness gate fails.
- Cache the app shell, editor assets, and a complete existing document while online. Close the browser, disconnect the network, reopen the same cached document URL, edit, reconnect, and verify permission recheck and durable sync.
- Verify pending edits survive an expired offline token but the body is locked until the same user authenticates online. Logout and account switching follow the offline contract in the refactor plan.
- Connect a client with an incompatible `BodySchemaVersion`; the server rejects its update before merge, and the client retains pending data for a compatible app or explicit recovery. No automatic schema mismatch merge is allowed.
- Do not require offline document discovery/search, uncached URLs, or recovery after browser site data eviction.
- Test restore and structural MoveNode/DeleteNode epoch changes: stale pending updates are not merged automatically and are available for user review.
- Delete a persisted block while another client has an offline text edit against it. `DeleteNode` must atomically rebuild AST/Yjs, increment `body_version`/`body_epoch`, and commit a durable receipt. Verify the old-epoch update is rejected before merge/ACK and remains pending after reload/reconnect. Retry the same command after a lost ACK and after a later epoch change; return its original receipt without applying delete or incrementing versions again.
- Queue `DeleteNode` offline with its command ID and origin epoch/schema. On reconnect, submit it only when the origin epoch still matches; otherwise retain it as a reviewable conflict. Never relabel its epoch or turn it into a Yjs `UPDATE`.
- Treat each `suggestion_id` as one atomic change set: accepting applies every operation once in one body transaction; rejecting applies none; a conflict cannot partially apply the batch. Separate suggestion IDs remain independently reviewable.

### RAG, when that phase begins

- Do not add embeddings or vector-store tests to the AST refactor gate.
- When RAG projection is implemented, verify source fingerprint/version freshness, permission checks at retrieval time, node citations, partial-coverage indication for skipped opaque nodes, and exclusion of stale or unauthorized sources.
- For contextual follow-up, retain prior User questions but omit an old assistant answer from the model prompt if any citation is no longer readable or its source fingerprint changed; verify the new answer uses current retrieval only.
- Race answer finalization against source ACL revoke and body change: if the mutation commits first, discard the model draft and do not save/deliver it; if finalization commits first, preserve the historical answer under the selected retention policy.
- Race answer finalization against permanent source deletion: when deletion wins, do not save the draft; when finalization wins, deletion removes its citations but leaves the answer text and removed-source marker.

## Test failure rules

- A test failure, missing service, migration failure, or fixture setup failure is a failed test run; do not convert it to a skip or a success-shaped status.
- No CI or E2E test may point at production or a persistent development database.
- A test may not depend on a prior test's user, workspace, project, document, or execution order.
- Do not report an edit as saved before the persistence boundary under test has committed.
