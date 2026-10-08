# DBML and Mermaid collaboration

Status: agreed on 2026-10-08; ready for implementation. Product and technical choices were confirmed by the user. Implementation, database reset and deployment have not started.

## Goal

Give standalone DBML and Mermaid documents collaborative source editing and durable database-backed persistence using the existing document and collaboration systems. A local-only autosave is insufficient.

## Agreed product contract

| Area | Behavior |
| --- | --- |
| Editing | Multiple authorized Users edit DiagramSource together, with presence and remote cursors. |
| Offline | Previously opened documents remain editable; normal reconnect merges pending edits. Fresh offline document creation is outside this release. |
| Invalid syntax | Synchronize and persist exact source, including unfinished syntax. Show parse errors and retain the last valid preview with a stale indicator. Before a first valid render, show the error without inventing a diagram. |
| DBML layout | Table positions, edge bends, zoom and pan remain device-local. |
| Access | Editor/owner grants mutate source; viewer/commenter grants read only. Comments and Suggest mode are outside this release. |
| Undo/Redo | Only the acting User's source operations are tracked. Format and template replacement each form one operation. Undo history belongs to the active editor session, not a durable cross-device history. |
| Mermaid templates | Empty source applies directly. Nonempty source requires confirmation that the shared document will be replaced, followed by one locally undoable replacement against current source. |
| Restore | Replace the active body with the selected revision. Clients automatically open that record. Restore does not enter editor Undo; recovery of an earlier state uses revision history. |
| Offline edits across restore | Do not merge operations from the replaced body into the active record. Automatically retain unsynced old source in user-scoped recovery storage before switching; no blocking resolution dialog. |
| Existing data | This instance is development-only. Its intended DokuDocs database may be reset; legacy documents, historical revisions and device-only legacy edits need no migration. |
| Other document types | Do not change Markdown/Architecture restore semantics in this feature. Changes to shared helpers must retain their existing behavior and have caller regression coverage. |

Restore/recovery choices above replace the earlier proposed automatic merge and Undo-of-restore behavior.

## Current implementation facts

- Frontend/API document types already include `dbdiagram` and `mermaid`. `dbml` is Monaco's language name; no new document enum is needed.
- Backend documents already store source in `documents.content`. Creation through the API exists; the legacy editor's `useDocEditor` saves to Zustand rather than persisting subsequent body edits to the server.
- `doc-editor.tsx` routes these types through `HydrateLegacyDocument` and `ScopedDocEditor`; only Markdown and Architecture enter the collaborative editors.
- `collab/src/server.ts` and backend `room_head.go` currently reject DBML/Mermaid rooms.
- `openCollabSession` already provides transport, presence, LocalCopies, reconnect, sign-out integration and room acknowledgement.
- `CollabStateStore` stores encoded state, JSON and derived text transactionally. Its load path reads JSON, not raw `documents.content`, so source initialization needs an explicit contract.
- `hasCollabBody` controls REST body ownership. Merely permitting rooms would leave a competing whole-body writer.
- Current Markdown restore sends a transient `reloaded` notice and drops the old record. A disconnected client can miss it; the session has no durable replacement-generation check before ordinary reconnect synchronization. Reusing that notice alone would not satisfy the chosen replacement policy.
- `session.drained()` establishes room receipt, not a PostgreSQL commit. Persistence currently defaults to a 2-second debounce and a 10-second maximum debounce.

## Recommended technical design

[ADR 0033](../adr/0033-dbml-and-mermaid-use-collaborative-source-text.md) records the accepted representation and trade-offs, extending [ADR 0029](../adr/0029-hocuspocus-and-yjs-state-replace-the-ast-stack.md).

```text
Monaco model ↔ Y.Text('source') ↔ existing Hocuspocus room
                    ↕                       ↕
             user-scoped LocalCopy     Go internal API
                                            ↕
                                       PostgreSQL
                           encoded state + source JSON + raw source
```

Use `Y.Doc.getText('source')` and JSON `{ "source": "..." }`. The server derives the exact source into `documents.content`; parser output is never the stored authority. Empty text, whitespace, Unicode and invalid syntax remain content. Validate payload shape, type, workspace and existing size/rate limits without enforcing diagram syntax.

Bind Monaco to shared text. [y-monaco](https://github.com/yjs/y-monaco) documents Y.Text binding and remote selections and is a candidate new dependency; verify installed-version compatibility before adoption. Prevent the legacy whole-model prop replacement and local autosave callbacks from becoming a second writer. Source synchronization continues when preview rendering is paused.

Use [Yjs origin-scoped UndoManager](https://docs.yjs.dev/api/undo-manager) for local typing, Format and template operations; route keyboard and toolbar Undo/Redo through it. Separate deliberate bulk commands from surrounding typing. A formatter result calculated from stale source must be recomputed or discarded.

### Durable persistence and revisions

- Initialize source consistently on create, import and duplicate, including empty documents. The service seeds shared text exactly once; clients never independently insert initial source.
- Keep encoded state, JSON and raw source in one store transaction. Extend room eligibility, seed/derive dispatch and REST body protection together.
- Use server-backed metadata operations for title, project and categories where applicable. Metadata updates must not overwrite collaborative source. Offline editing covers source; unavailable online-only metadata actions remain disabled.
- A visible saved state requires confirmed database persistence. Distinguish pending local changes, room synchronization and committed storage; inspect existing flush/status hooks before adding a protocol.
- Automatic/named revisions and revision export consume exact stored source. Architecture version pins and public/export/thumbnail readers retain their existing interfaces and immutable revision behavior.
- Before explicit named-version capture, establish a durable persistence boundary for the relevant source; do not infer it from `drained()` alone. If storage fails, report pending/failure rather than publishing a falsely current snapshot.

### State replacement on restore

1. Authorize the restore and validate the target immutable revision using existing backend access rules.
2. Persist the selected source/JSON and replace the active collaboration record with an idempotent restore receipt; preserve a pre-restore revision for history recovery.
3. Use a durable replacement identity that changes only on body replacement. `body_version` advances on ordinary saves, so it cannot be used directly to invalidate device copies.
4. Validate the replacement identity before accepting Yjs synchronization and when storing room state. A stale room/store cannot write over the restored identity.
5. Notify connected clients, which retain unsynced old source in user-scoped recovery storage, then dispose the old binding/Undo session and open the replacement record.
6. Disconnected or cold-offline clients detect the changed identity at reconnect **before sending old updates**, retain their unsynced source, and open the replacement automatically. A transient broadcast is only a refresh hint.
7. Expose a nonblocking recovery indication/export action. Keep recovery data separated by User/workspace/document/old identity and follow the existing user-storage sign-out and account-isolation policy. Do not silently delete recovery data because it was never sent to the restored room.

The final wire/schema details must fit the existing session/API seams. No extra collaboration service or text-diff restore engine is planned. Resetting the development database does not eliminate restore authorization, retry, race or offline-copy requirements.

## Delivery sequence and code boundaries

1. **Storage and source adapter.** Extend backend room eligibility, creation/import/duplicate initialization, `CollabStateStore` projections and `hasCollabBody` protection; add service source seed/derive and correct read-only/suggester branching. Prove restart persistence before UI integration.
2. **Collaborative source editor.** Update `doc-editor.tsx` dispatch and Monaco lifecycle; integrate DBML/Mermaid controls, remote selections, local Undo and server-backed metadata. Keep DBML preview layout local and source updates separate from preview debounce.
3. **Offline and lifecycle.** Reuse `collab-session.ts`, LocalCopies and sign-out/flush registration. Extend `auth-guard.ts` and document caching/dispatch for previously opened source documents. Handle refusal/revocation on existing connections.
4. **Restore and revisions.** Implement durable replacement detection, restore receipts, stale-store suppression and automatic user-scoped recovery. Verify named revisions, public source/export and linked Architecture version consumers.
5. **Verification and development rollout.** Ship frontend/service/backend contracts together. Reset only the selected DokuDocs development database; remove obsolete DokuDocs document copies through an explicit targeted procedure, not an unrelated browser-storage wipe. Recreate via current migrations and seed fixtures.

Relevant backend code lives in `backend/internal/infrastructure/repository/document/` (`room_head.go`, `collab_body.go`, `collab_state_store.go`, create/update/duplicate/revision/restore queries) and the internal collaboration/document handlers. Frontend changes reach `unified-monaco-editor.tsx`, `dbml-editor.tsx`, `mermaid-editor.tsx`, create/import dialogs, metadata and revision callers. Service changes reach `collab/src/server.ts`, authorization/permission hooks, source adapters and storage/reload signaling.

## Acceptance checks

- Two editor sessions converge for inserts/deletes, multiline paste, Unicode and invalid source in both types. Remote operations do not lose the caret or enter another User's Undo history.
- Source survives page refresh, room eviction, service/backend restart and a different device opening the document; database JSON/source/encoded record agree. Empty/imported/duplicated documents do not double-seed or normalize their text.
- Metadata survives server roundtrips and cannot overwrite source. Legacy full-body REST updates are rejected/preserved according to collaborative body ownership.
- Viewer/commenter access cannot mutate through Monaco, Format, templates, direct room updates or body APIs. Access revocation affects open connections.
- Preview pause does not stop synchronization. Invalid source remains stored and error/stale-preview states are clear.
- Normal offline edits survive a cold restart and merge on reconnect to the same replacement identity; sign-out and user switching cannot mix device data.
- Restore during live editing, disconnection and cold offline restart activates only the selected replacement record. Old pending source is retained separately without a blocking prompt; stale updates/stores cannot overwrite it.
- Duplicate restore IDs, lost responses and service/database errors do not cause repeated restores or false success. Pre-restore history remains recoverable; restoring again uses revisions rather than editor Undo.
- Own Undo/Redo handles Format and confirmed Mermaid templates as separate operations while preserving remote edits. Refresh resets the session's Undo history; revisions remain durable.
- Automatic/named revisions, public reads, export, thumbnails and frozen Architecture version readers consume the correct persisted source and preserve access boundaries.
- Shared-helper changes retain existing Markdown/Architecture behavior and receive focused regression coverage.

Use focused collaboration-service tests, Go persistence/access/restore integration tests, frontend Monaco browser tests and the existing two-browser/offline smoke pattern. Legacy dataset migration tests are unnecessary for the approved development reset; new-document persistence/security tests remain required.

## Performance verification

No performance benchmark has been run. Retain existing service connection/rate/payload limits; no new capacity or SLA claim is part of this plan.

Measure representative repository sources and larger fixtures: caret/preview responsiveness, update and encoded-state sizes, database write count/time to durable acknowledgement, and client/room memory during edit/restore/reconnect cycles followed by disposal. Debounce rendering independently of source sync. Group Format/template operations in one transaction; the [Y.Doc API](https://docs.yjs.dev/api/y.doc) documents batching as a way to reduce event calls.

State replacement avoids the proposed source-diff restore and actor-owned restore Undo machinery. It still incurs persistence, reseeding/reopening and preview work; it is not proven cheaper without measurement. Cross-type restore redesign, persistent Undo history, shared DBML layout, comments and Suggest mode are outside this release.

## Documentation and approval

`CONTEXT.md` records the agreed product vocabulary, and ADR 0033 is accepted. The user confirmed shared understanding of this complete plan on 2026-10-08. This approval finalizes the documents; it is not a request to implement, reset the database, deploy or push.
