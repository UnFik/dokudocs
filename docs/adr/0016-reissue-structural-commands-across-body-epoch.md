# Re-issue pending structural commands across a BodyEpoch

Supersedes the "never relabel or retarget" clause of [ADR 0014](0014-structural-moves-start-body-epoch.md) for a pending `DeleteNode` or `MoveNode`. [ADR 0012](0012-movenode-owns-existing-node-structure.md) and the receipt model of [ADR 0009](0009-durable-movenode-receipts.md) still hold.

A pending command names nodes by stable ID, so its intent does not change when the epoch does. When the epoch moved on, the client first replays the command unchanged, with its original `commandID` and epoch. If the response to the original was lost, the server returns the existing receipt and nothing is duplicated. Only when the server rejects it as stale does the client look at the current body:

- `DeleteNode`: if the node is already gone, the intent is satisfied and the command is dropped. If it still exists and its subtree is identical to the subtree the user last saw, the command is re-issued with a new `commandID` at the current epoch. If the block gained or lost content since, deleting it would destroy something the user never saw, so the command stays for review. The root is never deleted.
- `MoveNode`: re-issued with a new `commandID` at the current epoch when the node and the target parent still exist, the target is not inside the moved subtree, and `beforeNodeID`, if any, is still a child of the target. Otherwise it stays for review.

The swap of the old command for the new one, together with the canonical snapshot of the new epoch, is one IndexedDB transaction, and the editor then restarts from the canonical body so the re-issued command runs from the normal path. The provider allows only one pending structural command at a time, so there is no ordering question between commands; a second one is refused until the first completes.

Unchanged: Yjs updates from an earlier epoch are rebased by node ID ([ADR 0015](0015-rebase-pending-edits-by-node-id.md)) or held for review, and a command that fails any check above is held for review with nothing merged.
