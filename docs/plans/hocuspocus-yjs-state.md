# Plan: mirroring Outline: Hocuspocus and Yjs state, and the editor and page features

Status: draft for discussion. Two tracks: **A** the collaboration engine (Hocuspocus, Yjs state) and **B** the editor and page features Outline has. Nothing here is built. Numbers marked "measured" come from the repository; durations are rough estimates by one reader of the code, not commitments.

## Why

Most of the trouble in collaborative editing comes from one design choice: the server checks every update against a canonical AST and answers with epochs, structural commands (DeleteNode, MoveNode) and a review screen. Deleting a line, undoing a delete, pasting a document and offline merging each need a special path, and each path has produced a user-visible error (`update-rejected`, "structural deletion requires a DeleteNode command", a rebuilt editor that loses the caret). Outline avoids the class of problem: the Yjs document is the only source of truth and the server relays and stores it.

Second goal: the document page and editor offer what Outline's do (contents panel, document meta line, title as the first line, the "+" on empty lines, the full block menu and the editing helpers around it), on top of the suggest mode and comments that Outline lacks.

Goal of track A: users never see an internal error from an ordinary edit (CONTEXT.md, Seamless Edit), deletes and undo behave like any editor, and the collaboration code is small enough to own.

## What Outline does (read from `references/outline`)

- Server: Hocuspocus (`@hocuspocus/server` 1.1.3 there) with extensions for authentication, persistence, connection limits, editor version, logging, metrics, views and API updates. About 960 lines of source.
- Storage in Postgres `documents`: `state` (BLOB, the Yjs state, source of truth), `content` (JSONB, ProseMirror JSON derived from `state`), `text` (deprecated Markdown). Revisions keep `content` only. Files and images are `Attachment` rows pointing at S3.
- Open: the client fetches `content` through the API and shows it read-only until the realtime connection (or IndexedDB copy) has synced, then switches to the live editor.
- Load (`onLoadDocument`): `state` if present; otherwise build a Y.Doc from `content` (or `text`), save it to `state` once.
- Store (`onStoreDocument`): debounced; writes `state` and the derived `content` in one transaction; failures are logged and retried, editing is never blocked.
- Updates from REST (`APIUpdateExtension`): published on Redis, the live document reloads from the database and broadcasts.
- The server does not validate update contents. A read-only connection is refused as a whole. There is no suggest mode; comments are marks in the document.
- Licence: Outline is Business Source License 1.1 and forbids use for a "Document Service". Do not copy its code. Hocuspocus, y-prosemirror and y-indexeddb are MIT. Copy ideas, not files.

## What would go (measured, source lines, tests excluded)

| Area | Source | Fate |
|---|---|---|
| Go collaboration (`infrastructure/collaboration`, `application/collaboration`) | 4.0 k | replaced by a Node service; relay, epochs, structural commands, receipts gone |
| `domain/documentbody` + AST writers in `repository/document` | about 7 k | AST becomes a derived read model, or goes (decision D3) |
| Frontend provider, socket, store, recovery, review, rebase | 8.4 k | replaced by HocuspocusProvider + y-indexeddb, about 0.5 k |
| ProseMirror engine | 7.4 k | kept; suggestion tracking kept or cut (decision D2); delete/paste/undo special cases shrink |
| e2e smoke | 5.6 k | structural, offline-review and rebase specs removed; the rest adapts |

## Decisions needed before building

- **D1. Where Hocuspocus runs.** (a) A Node service next to the Go API, calling the Go API for authorization and storage; or (b) implement the Hocuspocus wire protocol in Go. Recommendation: (a). The protocol is not just y-protocols and (b) is a second project.
- **D2. Suggest mode.** Today a commenter writes suggestions into the shared body and the server proves they changed nothing else (ADR 0027, `suggestion*.go`, 1.5 k lines). Outline has nothing like it. (a) Keep it: port the validator to a Hocuspocus message hook (`beforeHandleMessage`, to be verified for the chosen version), TypeScript, same rules. (b) Drop suggestions in the body; commenters propose text through comments and an editor applies it. (c) Keep the legacy stack for documents that use suggestions. Recommendation: decide after the spike; (a) keeps the product goal and costs the most.
- **D3. Derived data.** `content` JSON is derived from `state` on store. Search, RAG, duplicate and list read AST rows today. (a) Keep AST rows as an asynchronous projection built after each store (Go projects from `state`, as it does now); (b) move consumers to `content`. Recommendation: (a) first, it keeps consumers untouched.
- **D4. Schema.** Keep our ProseMirror schema (node IDs, runs). Existing Yjs states then migrate byte for byte with no conversion. Adopting Outline's schema is not worth it and brings the licence problem.
- **D5. Revisions and restore.** Epochs go. Restore writes `state` and `content` and tells the live room to reload (Outline's API-update path), instead of a new epoch.
- **D6. Hocuspocus version.** Outline pins 1.1.3. Check the current major (hooks, `beforeHandleMessage`, Redis extension, auth flow) before committing.
- **D7. Rollout.** Per-document engine flag with both stacks live for a while, or a single cutover. Recommendation: flag per workspace, then remove the legacy stack.

## Target flow

1. Open: client fetches the document and `content`; renders it read-only; opens a Hocuspocus connection with the JWT and workspace; also loads the IndexedDB copy.
2. Authenticate: the Node service asks the Go API whether this user may read, comment or edit this document; viewers (and commenters, under D2 (b)) connect read-only. Closing codes mirror Outline's: authorization changed (reconnect), forbidden, too many connections, client too old.
3. Load: Node asks Go for `state`; if absent, builds a Y.Doc from `content`, saves once.
4. Edit: everything is a Yjs update. Delete, paste, undo and offline merge need no command, epoch or review.
5. Store: debounced; Node sends `state` and derived `content` to Go in one call; Go writes both in one transaction and schedules the AST projection, RAG index and revision.
6. Scale: Hocuspocus Redis extension; Go notifies the room on REST changes (restore, import) through Redis.
7. Comments: stay in their tables with Yjs relative-position anchors (valid, same document); the room hears about changes through a stateless message instead of the `comments_changed` frame.

## Phases

| Phase | Content | Exit criteria | Rough effort |
|---|---|---|---|
| P0 Spike | Node Hocuspocus service, auth call to Go, load and store `state`, our schema in the editor, two browsers | delete line, delete all, Ctrl+Z after delete, paste the PRD fixture, offline edit and reconnect all work with no special path and no error; decide D2 | 3 to 4 days |
| P1 Service | Production Node service: auth, persistence, limits, Redis, logging, metrics, health; compose and CI; internal Go endpoints | service runs behind the gateway; load test (collab-load) passes at current targets | 1 to 2 weeks |
| P2 Data | The Yjs state already lives in `document_collab_states.encoded_state` and keeps working as is (same schema, same field `body`). Add `documents.collab_engine` for the rollout flag; `documents.content_json` only if the first paint should come from a JSON cache (optional, the client can render from `encoded_state`). The AST projection (`document_nodes`) and `document_suggestions` are written after each debounced store instead of each update. Epoch, receipt and restore-receipt columns stay until P7 | migration reversible; projection and suggestion index match the legacy ones for every seeded document; search and RAG tolerate the projection lagging a few seconds | 3 to 5 days |
| P3 Frontend | HocuspocusProvider + y-indexeddb; cached `content` first paint; drop provider, recovery, review, epochs, command locks, remount code; awareness for presence and cursors | existing editor e2e specs pass minus the removed ones | 1 to 2 weeks |
| P4 Permissions, suggestions, comments | per D2; comment hints by stateless message | suggester cannot change canonical text (ported tests); comments live | 1 to 3 weeks (D2 (a) is the long end) |
| P5 Consumers | search, RAG, export, import, duplicate, list, revisions, restore | each reads the projection or `content`; restore reloads the room | 1 week |
| P6 Cutover | flag per workspace, dual run, switch, watch error rates | no `update-rejected`-class errors in the logs for a week | 1 week plus watching |
| P7 Cleanup | delete the Go collaboration stack, epochs, commands, review UI and their tests; mark ADRs 0017 to 0028 superseded where they are; update CONTEXT.md | no dead code left | 3 to 5 days |
| B1 Small features | see track B | each feature has an e2e or unit test; no regression in smoke | 2 to 3 weeks, parallel to P0 to P3 |
| B2 New node types | see track B | each type round-trips Markdown and persists | 2 to 3 weeks, after P6 |
| B3 Service-backed features | see track B | | about 3 weeks |
| B4 Uploads, embeds, large features | see track B | storage decision recorded as an ADR first | months |

Total for track A, one engineer: about 6 to 10 weeks with D2 (a), 4 to 6 weeks with D2 (b). Track B1 to B3 adds about 7 to 9 weeks and can overlap track A; B4 is not estimated. The spike is what makes these numbers real.

## Risks

- D2 (a) is the largest single piece and the one place where Outline gives no help.
- A debounced store means a crash can lose the last seconds of edits unless the service persists on disconnect and on shutdown (Outline stores on the last disconnect; copy that behaviour, and add a store on SIGTERM).
- Two stacks in production during P6 double the surface; keep the window short.
- Large documents: Outline caps `state` size; decide our cap and the error shown.
- Node service is one more thing to deploy, monitor and secure; auth to Go must not leak tokens in URLs (our socket already keeps the token out of the URL).
- Tests are the real cost: about 5.6 k lines of e2e and thousands of unit lines touch the removed paths.

## Not in scope

The permission model and moving file storage. Uploads and embeds are in track B tier 3 and wait for a storage decision; the orphaned-asset question for suggestions (issue #94) stays open under D2.

## First step

Two things can start at once and do not block each other. Track A: run P0 on a branch (`spike/hocuspocus`), time-boxed to 4 days, with the exit criteria above, and decide go or stop from what it shows. Track B: start B1 on the current stack, beginning with the "+" trigger and the document meta line. Until the cutover, the incremental editor fixes (#98, #101, #103, #104) remain the way to improve the editor.

## Schema changes in short

Almost none are needed up front. The Yjs state already has a table (`document_collab_states`), comment anchors are Yjs relative positions and stay valid, and the AST table stays as a derived read model. New: a rollout flag (`documents.collab_engine`), and optionally a JSON cache column. Removed later, in the cleanup phase only: `body_epoch`, `compat_epoch`, `document_command_receipts` and the restore-receipt columns on revisions. No data conversion: existing states are used byte for byte.

## Track B: mirroring Outline's editor and page features

Read from `references/outline` (names, menus, and the doc comments of the extensions). Where only a name or a one-line comment was read, the row says "check before building". Do not copy code (licence, above); reimplement behaviour.

### What exists on each side

| Feature | Outline | DokuDocs now |
|---|---|---|
| Heading, list, bold, italic, code, strike, link | yes | yes (shortcuts, selection toolbar, typing rules) |
| Block menu `/` | headings in 4 sizes, todo, bulleted, ordered, image, video, embed PDF, file attachment, table, quote, code, math, divider, page break, current date, toggle block and 4 toggle headings, 4 notices (info, success, warning, tip), Mermaid, Diagrams.net | headings 1 to 3, bulleted, ordered, task, quote, code, table, divider, math, mermaid |
| "+" button on an empty line that opens the block menu | yes (`block-menu-trigger`) | no |
| Contents panel beside the text, current heading highlighted; headings inside tables left out | yes (`Contents`) | no |
| Document meta line: updated by, relative time, draft, last viewed | yes (`DocumentMeta`) | a "Last saved at" tooltip |
| Title as the first line, Up arrow at the start of the body goes to it | yes (`DocumentTitle`, `UpArrowAtStart`; check before building) | title edited in the header |
| Heading anchors (copy link to a heading) | yes (`HeadingPrefix`; check before building) | no |
| Trailing empty paragraph so the end of the page can be clicked | yes (`TrailingNode`) | no |
| Undo a Markdown conversion with Backspace right after it | yes (`InputRuleUndo`; check before building) | no |
| Smart quotes, ellipsis, arrows | yes (`SmartText`, a user preference) | no |
| Marks: underline, highlight (colours) | yes | no |
| Notice and toggle blocks, current date, page break | yes | no |
| Mentions `@`, emoji menu `:` | yes | no |
| Find and replace | yes (`FindAndReplace`) | no |
| Paste handling: link paste, paste menu, other tools' HTML | yes (`PasteHandler`, `PasteMenu`) | Markdown and HTML paste, no menu |
| Hover previews of links | yes (`HoverPreviews`) | no |
| Comment gutter indicator | yes (`CommentGutter`, off on narrow screens) | comment rail |
| Size warning, maximum length, document stats | yes (`SizeWarning`, `MaxLength`, `DocumentStats`; check before building) | no |
| Image, video, file attachment, embeds (15 embed types in `shared/editor/embeds`) | yes | image node only |
| Presentation mode, references and backlinks, insights (views), revision change navigation | yes | no |
| Following another user (`ObservingBanner`), connection status | yes (need awareness and the provider; check before building) | presence avatars and cursors, status text |
| Version history, share, presence, comments | yes | yes |
| Suggest mode | no | yes |

### Tiers and rough effort (one engineer)

| Tier | Items | Depends on | Effort |
|---|---|---|---|
| B1: small, no schema | "+" trigger; document meta line (needs "updated by" from the API); title as first line with Up arrow and Enter; contents panel; heading anchors; trailing paragraph; Backspace undo of a typing rule; smart text | nothing in track A | 2 to 3 weeks |
| B2: new node or mark types | underline and highlight; 4th heading level; page break; current date; notices; toggle blocks | Markdown import and export for each (underline and highlight have no Markdown form: decide HTML or drop on export); Go AST type and validation until the new engine is live | 2 to 3 weeks; do after the cutover (P6) so the Go validation is not written and then deleted |
| B3: needs services | mentions and emoji (user directory API); find and replace; paste menu; link hover previews; comment gutter; size warning and stats | mentions need the workspace member API | 3 weeks |
| B4: large | uploads (image, video, file, PDF) and embeds; presentation mode; references and backlinks; insights; revision change navigation; following a user | storage decision (S3 or local, orphan assets, issue #94); awareness from track A for following | open-ended, months |

Order: B1 can start now, in parallel with P0, on the current stack. B2 waits for track A's cutover. B3 can interleave. B4 is planned only after a storage decision.

### Interactions with track A

- Under D3 (a) every new node type needs a Go node type and validation for the AST projection; under the new engine the projection can skip unknown types as opaque, so building B2 after P6 is cheaper.
- Following a user and the live connection indicator come from Hocuspocus awareness and provider status, so they are built in P3, not in B4.
- The "+" trigger, contents panel and document meta line are independent of the engine and survive the migration unchanged.

