# G1 runtime spike: Yjs compatibility and durable write ordering

Date: 2026-09-28  
Scope: static review of the default Go `reearth/ygo` and Node Hocuspocus update paths, plus the upstream Yjs compatibility tests. This is evidence for the G1 prototype, not a runtime selection or cutover approval.

Status note: dated follow-up sections below capture evidence as it was produced. The newer application-route and PostgreSQL integration status is summarized at the end and supersedes earlier statements that the editor or durable writer were not integrated.

## Findings

### Go `reearth/ygo`

The upstream project provides a Go Yjs-compatible CRDT implementation and a WebSocket provider. Its compatibility suite exercises Go-to-JavaScript, JavaScript-to-Go, and round-trip updates. At the inspected revision [`4d6865dc3677ba5e7f1d9d16007d73e214632c13`](https://github.com/reearth/ygo/tree/4d6865dc3677ba5e7f1d9d16007d73e214632c13), the four selected compatibility tests passed locally with Node/Yjs enabled:

```text
YGO_REQUIRE_NODE=1 go test ./crdt -run '^(TestCompat_GoToJS|TestCompat_RoundTrip_GoJSGo|TestCompat_RoundTrip_JSGoJS|TestCompat_ApplyJSUpdate_YXmlFragmentBigIntAttribute)$' -count=1 -v
PASS
```

This proves useful update-format compatibility for the tested text, map, array, XML, and fixture cases. It does not prove compatibility with Dokudocs' editor binding or Markdown AST projection.

The default WebSocket path applies an incoming sync message to the in-memory document and broadcasts it from the same handler ([`peer.go`](https://github.com/reearth/ygo/blob/4d6865dc3677ba5e7f1d9d16007d73e214632c13/provider/websocket/peer.go#L75-L99)). Persistence is wired through a document update observer and a buffered worker ([`server.go`](https://github.com/reearth/ygo/blob/4d6865dc3677ba5e7f1d9d16007d73e214632c13/provider/websocket/server.go#L1738-L1752)); write errors are logged by the worker ([`persistence.go`](https://github.com/reearth/ygo/blob/4d6865dc3677ba5e7f1d9d16007d73e214632c13/provider/websocket/persistence.go#L333-L357)). Therefore the stock path does not make PostgreSQL commit a prerequisite for applying/broadcasting the update or sending the protocol response. Disabling persistence coalescing would not change that ordering.

### Node Hocuspocus

Hocuspocus stores binary Yjs document state; its persistence guide warns against replacing it with a JSON reconstruction because that loses CRDT history ([persistence guide](https://tiptap.dev/docs/hocuspocus/guides/persistence)). Its documented `onStoreDocument` hook is debounced ([hooks](https://tiptap.dev/docs/hocuspocus/server/hooks), [configuration](https://tiptap.dev/docs/hocuspocus/server/configuration)).

At inspected revision [`0d9a7ff778ba0400c17a66d9de639523506f6f9`](https://github.com/ueberdosis/hocuspocus/tree/0d9a7ff778ba0400c17a66d9de639523506f6f9), `Connection` awaits `beforeHandleMessage`, applies the message, and then invokes `afterHandleMessage`; errors from the latter are logged and swallowed ([`Connection.ts`](https://github.com/ueberdosis/hocuspocus/blob/0d9a7ff778ba0400c17a66d9de639523506f6f9/packages/server/src/Connection.ts#L270-L285)). `Document.handleUpdate` runs its update callback and broadcasts/batches the update synchronously ([`Document.ts`](https://github.com/ueberdosis/hocuspocus/blob/0d9a7ff778ba0400c17a66d9de639523506f6f9/packages/server/src/Document.ts#L332-L354)); `onStoreDocument` runs separately through a debouncer ([`Hocuspocus.ts`](https://github.com/ueberdosis/hocuspocus/blob/0d9a7ff778ba0400c17a66d9de639523506f6f9/packages/server/src/Hocuspocus.ts#L514-L527)). These hooks do not provide the required PostgreSQL-commit-before-ACK-and-fan-out contract.

## G1 consequence at initial review (2026-09-28)

Neither stock server write path satisfies the required durable-ACK ordering as configured. The Go library has positive byte-compatibility evidence, but its standard WebSocket writer also needs replacement or a transaction-owning integration. Do not select a runtime from this spike alone.

The next G1 prototype should compare a small custom transaction-owning update path against the same browser Yjs fixtures: merge, project/validate opaque and structural invariants, atomically commit CRDT state plus AST/version/receipt, then ACK and fan out. Include forced PostgreSQL rollback and dropped-ACK retry. The editor binding, browser authentication/revocation, multi-instance fan-out recovery, and hot-document capacity still need proof.

## Muya/editor integration finding

At the time of the initial review, Muya's `JSONState` owned a `TState[]` tree, parsed Markdown through `MarkdownToState`, and emitted path-based `ot-json1` operations (`frontend/src/features/docs/lib/muya/state/index.ts`). The frontend had no Yjs or `y-prosemirror` dependency and the editor did not bind its edits to a Yjs shared type. A Yjs update cannot be passed into Muya as if it were the same operation format.

`ygo` exposes `Y.XmlFragment`, `Y.XmlElement`, and `Y.XmlText` APIs, and its fixtures prove those structures can round-trip with JavaScript Yjs. That is transport/CRDT compatibility evidence only. At the time of the initial review, Dokudocs still needed a schema mapping for ProseMirror node names, attributes, text marks, and stable `node_id` values, plus validation against the canonical body grammar. The existing `ImportMuyaState` maps already-parsed Muya block JSON and preserves each block's `text` as a string; it does not parse inline marks into canonical run nodes or bridge editor operations/Yjs XML into AST.

The editor spike must compare the cost and correctness of (a) a maintained Yjs binding around Muya's model versus (b) keeping the view/editor/suggestion experience while replacing the engine with ProseMirror/Tiptap. Keep the engine undecided until a real browser edit can be encoded as Yjs, accepted by the durable writer, reloaded, and rendered back with equivalent AST and selection/anchor behavior. The follow-up section records the candidate schema codec and its remaining limits.

## Follow-up editor binding spike (2026-09-28)

The DokuDocs frontend still has no Yjs or ProseMirror dependency. Muya's `JSONState` applies `ot-json1` operations to indexed paths and emits `json-change`; those operations are not a Yjs binding. Outline's checked-in editor uses `y-prosemirror` `^1.3.7` with Yjs `^13.6.31`, and its `Multiplayer` plugin binds a ProseMirror `XmlFragment` with sync, cursor, and Yjs undo plugins. The [upstream y-prosemirror README](https://github.com/yjs/y-prosemirror/blob/master/README.md) describes the same `Y.XmlFragment` ↔ ProseMirror binding and local-per-client undo model.

An isolated prototype under `/tmp/dokudocs-editor-spike` used those Yjs/y-prosemirror versions and the Outline-compatible ProseMirror model/state/view versions. In headless Chromium, two ProseMirror editors backed by separate `Y.Doc`s successfully:

- applied and exchanged text and mark changes, then converged to the same ProseMirror JSON;
- retained paragraph and opaque-inline `nodeId` attributes;
- resolved a Yjs relative-position comment range to the original text after a remote insertion before the range;
- undid a local edit while preserving a remote peer's insertion and formatting;
- rendered an opaque inline atom as `contenteditable="false"` and rejected a transaction that deleted it.

This is positive evidence for ProseMirror plus `y-prosemirror` as an editor candidate. It is not a Muya comparison result or an engine selection: the prototype used one paragraph schema and an in-process update exchange, not the complete Markdown AST, Muya's three-mode experience, WebSocket, PostgreSQL durability, or multi-instance recovery. The guard was a client-side prototype; server-side `ValidateOpaquePreservation` remains necessary. Tiptap's [Collaboration extension](https://tiptap.dev/docs/editor/extensions/functionality/collaboration) also bundles its own undo/history behavior, but this spike intentionally used the lower-level open-source binding.

## Follow-up AST binding spike (2026-09-28)

The frontend now has an isolated candidate schema and pure converters between the current `DocumentBodyNode[]` grammar and ProseMirror. The document root is an explicit ProseMirror node so its stable `nodeID` is stored inside the Yjs `XmlFragment`; each AST node stores its `nodeID` and JSON attributes as scalar XML attributes. Block/run text maps to ProseMirror text; opaque source and thematic-break source stay in scalar attributes. Existing flat-body indexing is shared by the Markdown exporter and editor codec.

A focused browser corpus exercised every currently supported AST node type, nested quote/list/table/footnote structures, run formatting and link metadata, direct parent text from legacy rows, and opaque source. AST → ProseMirror → Yjs → ProseMirror → AST retained the nodes, IDs, attributes, source text, and sibling order. A second browser test mounted two ProseMirror views over separate Y.Docs, inserted text concurrently into the same formatted run, exchanged Yjs updates, and observed converged ProseMirror/AST results. Vite had to deduplicate `yjs` and ProseMirror peers after the browser runner initially loaded two Yjs instances; the configured test then passed. The existing Markdown fixture corpus also passed in its browser runner. Frontend production build and targeted lint passed.

This proves a full-schema binding smoke path, not a working editor integration. The candidate is not wired into Muya's view/editor/suggestion modes or application routes. A partial format change inside one `run` creates mixed marks that the projector currently rejects; the editor command must split the run and assign the new ID in the replicated transaction. Generated nodes with missing IDs and duplicate IDs are rejected by projection. Opaque nodes render as read-only atoms in this schema, but a transaction filter and durable server enforcement still need to be connected. The full Markdown corpus through this schema, comments/relative selection anchors, editor undo, offline recovery, WebSocket authentication, and durable PostgreSQL writer remain unproven; keep the editor/runtime undecided.

The next adapter step adds `prepareBodyTransaction`, which must run before the Yjs sync plugin sees a local transaction. It wraps formatted or mixed inline text from legacy parent content in `run` nodes, splits runs whose child marks diverge, and assigns UUIDs to missing/duplicate IDs in that same ProseMirror transaction. A browser test confirms a peer receives both run segments and the generated ID from one Yjs update. Joining paragraphs reidentifies child runs whose old parent was deleted, while a surviving node's reparent/reorder is rejected unless its ID is listed as authorized by a durable `MoveNode` receipt. Opaque deletion, source mutation, direct reorder, and movement of an ancestor containing opaque content are rejected locally.

The transaction adapter is still not installed as the application's `EditorView.dispatchTransaction`; `authorizedMoveNodeIDs` is only a client-side gate and the server must validate the actual receipt and resulting tree. It does not yet make remote update projection durable. The full Markdown corpus through this schema, comments/relative selection anchors, editor undo, offline recovery, WebSocket authentication, and PostgreSQL writer remain unproven.

## Structural move versus pending offline text (2026-09-28)

A focused Yjs experiment used two clients loaded from the same ProseMirror-generated state. Client A moved a paragraph by deleting its integrated `Y.XmlElement` and inserting a new subtree with the same AST `nodeID`; client B, still offline, inserted text into the original paragraph's `Y.XmlText`. The server applied A's move update and then B's update. The visible paragraph kept its old text, while B's update targeted the deleted shared type. The `nodeID` stayed stable, but the Yjs type identity did not.

This matches `y-prosemirror`'s implementation: unmatched ProseMirror child nodes are deleted and a new Yjs type is created with `createTypeFromTextOrElementNode` in `sync-plugin.js`. The experiment is a direct Yjs type-level reproduction, not yet a full editor dispatch or PostgreSQL test.

Therefore, same-epoch CRDT merge after a subtree move is not safe to assume. Before enabling `MoveNode`, prove either that the selected model can preserve and merge edits against moved nodes, or that a structural move fences pending updates from the previous generation and retains them for user review. Never ACK an old-type update as an accepted body edit when its contents are absent from the visible AST. A corresponding G1/G3 acceptance case has been added to the execution plan.

## Follow-up dispatch integration spike (2026-09-28)

`createDocumentBodyEditor` now constructs a real ProseMirror `EditorView` over a caller-owned Yjs `XmlFragment`. Its `dispatchTransaction` runs `prepareBodyTransaction` on local document changes before `EditorState.applyTransaction` lets `y-prosemirror` write to Yjs. Transactions marked as Yjs-originated skip that local preparation. The adapter uses the Yjs undo plugin and provides one-block comment anchors encoded as Yjs relative positions; its caller owns `Y.Doc` lifecycle and transport.

Browser tests exercise the installed dispatch path: a partial format change splits a run, assigns a stable new node ID in the same update, and converges to a peer; deleting an opaque node is rejected and leaves both the local AST and Yjs state unchanged; a one-block comment anchor survives a remote insertion while cross-block anchors are rejected; and local undo preserves the peer insertion. Focused Chromium tests pass 12/12, the frontend production build passes, and focused ESLint passes.

At this point in the prototype, the adapter was not yet installed in the application route: the route still mounted Muya and persisted Markdown text. AST API reads/writes, comments, selection anchors, the authenticated WebSocket, and PostgreSQL durability were not yet connected. `MoveNode` authorization remains server-owned and cannot be enabled by a caller-provided client set. The Muya-versus-ProseMirror engine decision stayed open until the durable update path and required UI experience could be proven together.

## Follow-up Go transport adapter (2026-09-29)

The backend now has a candidate authenticated WebSocket route at `/api/v1/collaboration/{documentID}`. The browser sends its JWT and workspace ID in the first JSON frame, so credentials do not appear in the URL. The server checks the exact configured origin, reads the current body through the existing access policy, sends a durable Yjs snapshot, and accepts update envelopes with an update ID, epoch, schema version, and binary Yjs update. The PostgreSQL repository already performs merge, projection/invariant checks, and AST/Yjs/version commit in one transaction; the route sends `ack` only after that call returns and the ACK frame is written. The in-process hub publishes after ACK. Periodic head reads detect a missed message and send a full-state resync; each outgoing delivery rechecks token and read access. Application-level ping/pong closes sessions without a matching pong after 10 seconds; the browser provider must answer these JSON messages because the Go WebSocket package consumes native control pong frames internally. Queue saturation and server shutdown close sessions.

At this stage, focused Go tests passed for origin policy, contiguous update delivery, gap/epoch resync, heartbeat timeout, shutdown, timeout bypass, hijacker forwarding, and route registration; `go test -run '^$' ./...` compiled the backend. A `net.Pipe` test exercised the WebSocket handshake, auth frame, initial snapshot, ping/pong, update, and writer-before-ACK ordering without opening a listener. Join setup dropped queued fan-out already represented by its `ready` snapshot while retaining later updates. PostgreSQL transaction behavior, browser provider behavior, revocation while connected, multi-instance Redis fan-out, and loss recovery were still unverified end-to-end. Later PostgreSQL/WebSocket evidence is summarized below. The first implementation uses full snapshots every five seconds and a process-local hub, so the cadence, connection limits, and DB read cost need measurement before production. Keep Go as a candidate, not a final runtime decision.

The frontend had a candidate Yjs provider over the socket adapter and `mountCollaborativeDocumentBody` composition for the ProseMirror EditorView. It restored cached state, persisted snapshots and pending updates atomically, removed pending data only after ACK, applied remote updates/resync, retried, and held incompatible generations. Snapshot bytes were captured before queued IndexedDB work started. Storage/recovery/auth errors locked the editor; a confirmed read revoke cleared local IndexedDB and removed the rendered body. Eight Node-mode provider/socket tests passed; the ProseMirror browser suite passed 14/14 using a fake WebSocket and native IndexedDB, including ACK removal, read-only enforcement, and forbidden cleanup. Focused ESLint and production build passed. At that time this composition was not installed in the active route; real server WebSocket/ACL integration and logout cleanup remained open. See the superseding status below.

## Superseding application and PostgreSQL status (2026-09-29)

The UUID Markdown route now loads the canonical body through the body API and mounts `CollaborativeMarkdownBody`, which composes the ProseMirror editor with the Yjs provider. A legacy Markdown document without initialized AST is rendered in Muya read-only; initialized AST documents no longer use the old text-body editor path. See [`RemoteMarkdownDocEditor`](../../frontend/src/features/docs/components/remote-markdown-doc-editor.tsx) and [`mountCollaborativeDocumentBody`](../../frontend/src/features/docs/lib/collaborative-document-body.ts).

The backend has an integration test that connects owner and viewer clients to the real WebSocket route and PostgreSQL repository. The recorded `make test-integration` run verifies durable body version 2 before ACK, fan-out of that committed update to a read-only viewer, and rejection of the viewer's write; the test uses a Go Yjs client update ([`collaborative_websocket_integration_test.go`](../../backend/internal/infrastructure/repository/document/collaborative_websocket_integration_test.go)). This supersedes the earlier statement that PostgreSQL transaction behavior for this route was unverified.

G1 is still open: the integrated editor/provider has not been verified end to end with browser JavaScript Yjs updates against the Go writer, Redis multi-instance fan-out, live revocation, restart/reconnect recovery, and production sizing. The active route does not yet prove the full Muya-compatible view/editor/suggestion experience, and suggestion mode, durable offline `MoveNode` command queuing, and `DeleteNode` recovery remain incomplete; the epoch-fence policy is selected, but its command, receipt, and end-to-end proof are not implemented. The Go writer and ProseMirror editor remain candidates rather than a production runtime/editor selection. Current milestone evidence is tracked in the [gap-closure plan](../plans/dokudocs-refactor-gap-closure.md).
