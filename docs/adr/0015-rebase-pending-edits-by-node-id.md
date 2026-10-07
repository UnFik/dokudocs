# Rebase pending text edits by node ID across a BodyEpoch

> Superseded by [ADR 0029](0029-hocuspocus-and-yjs-state-replace-the-ast-stack.md): the AST, epochs and structural commands no longer exist.

Supersedes the "never merged automatically" part of [ADR 0014](0014-structural-moves-start-body-epoch.md); the rest of 0014 and all of [ADR 0012](0012-movenode-owns-existing-node-structure.md) still hold.

A changed `MoveNode` or `DeleteNode` still rebuilds AST/Yjs and increments `body_epoch`, and the server still rejects Yjs updates from an older epoch. What changes is what the client does with its own pending Yjs updates when the epoch moved on. Instead of always holding them for review, the client now three-way merges them by stable `nodeID`:

- `base` is the server state the pending edits started from (`baseEncodedState`, persisted next to the snapshot while updates are pending), `local` is base plus pending edits, `canonical` is the new epoch's state.
- Text edits to a node apply when the node still exists. Edits to the same text node merge when the changed regions do not overlap. Locally created nodes are inserted under their parent after their previous sibling.
- The merged body is written back as a fresh Yjs update on top of the canonical state (`y-prosemirror` `updateYFragment`), so unchanged nodes keep their Yjs identity. The update is stored at the new epoch, replacing the old-epoch pending update in one IndexedDB transaction, and the editor remounts from the rebased state.
- Any conflict (edited node deleted remotely, locally created node under a deleted parent, overlapping edits to the same text, missing base state, pending structural commands, schema change) keeps today's behaviour: nothing is merged, all pending updates stay on the device, and the user reviews or exports them.

Pending `DeleteNode` and `MoveNode` commands are not rebased; they still need review when their epoch changes.

Rejected: sending delete and move as ordinary Yjs updates (reverses ADR 0012 and 0014), and server-side rebase (adds work to the already heavy write path).

Cost to measure: the client encodes the full Yjs state once when the first pending update is created after the queue drained, to capture `base`.
