# Structural moves and deletes start a new BodyEpoch

> Superseded by [ADR 0029](0029-hocuspocus-and-yjs-state-replace-the-ast-stack.md): the AST, epochs and structural commands no longer exist.

The Yjs editor binding cannot preserve the identity of an integrated shared type when a node is reparented or deleted; rebuilding the document state can make pending updates from the old state appear to apply while missing their content. A changed `MoveNode` or `DeleteNode` therefore atomically rebuilds AST/Yjs and increments both `body_version` and `body_epoch`. The structural command has a durable receipt in the same transaction. Updates and commands from the previous epoch stay on the device for user review and are never merged automatically. An offline `DeleteNode` may be queued with its origin epoch; if that epoch changes before reconnect, retain it as a conflict and never relabel or retarget it. The current rebuild replaces the whole shared fragment, so this deliberately holds even unrelated pending edits; per-node rebase requires a proven identity-preserving representation and a superseding decision. The policy is settled; command implementation, retry behavior, and recovery still require proof before G1/G3 can pass.

> Update 2026-10-01: [ADR 0015](0015-rebase-pending-edits-by-node-id.md) lets the client merge pending text edits across an epoch by node ID when no conflict exists. Conflicting edits and pending structural commands are still held for review as described above.

> Update 2026-10-01: [ADR 0016](0016-reissue-structural-commands-across-body-epoch.md) lets the client re-issue a pending `DeleteNode` or `MoveNode` at the new epoch under a new command ID when the nodes it names still make sense; otherwise the command is still held for review.

