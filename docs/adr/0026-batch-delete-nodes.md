# Delete several blocks with one DeleteNodes epoch

> Superseded by [ADR 0029](0029-hocuspocus-and-yjs-state-replace-the-ast-stack.md): the AST, epochs and structural commands no longer exist.

Selecting several blocks, or the whole body, and pressing Delete is one gesture, so it is one structural command. `POST /documents/{id}/body/delete` takes either `nodeID` (one subtree, unchanged) or `nodeIDs` (two or more distinct subtree roots, at most 5000). The server removes the union of the subtrees in a single transaction, advances `body_version` and `body_epoch` once, and writes one receipt. Either every subtree is deleted or none is: an opaque, missing, or root node anywhere in the list rejects the whole command. A node listed inside another listed subtree is harmless. The receipt hash for a single node is byte-identical to before, so existing receipts still replay.

This is the batch command [ADR 0022](0022-table-column-delete-needs-a-batch-command.md) was waiting for. The objections there do not apply: it is one epoch, not N; the provider still holds one pending command; and no client sees an intermediate document, because the whole set goes at once. The editor translates a transaction that removes several independent subtrees, and changes nothing else, into one batch ([#58](https://github.com/UnFik/dokudocs/issues/58)). A transaction that also edits a surviving node is still rejected.

The pending command stores `nodeID` (the first target) and `nodeIDs`. When the epoch has moved on before the command is sent, targets another user already deleted are dropped and the rest is re-issued only if each remaining subtree is unchanged from what this user saw; otherwise the command is held for review, as for a single delete. Recovery export and review apply and describe every target.

Deleting every block leaves a body with only its root. The editor then inserts one empty paragraph as an ordinary edit so there is always a line to type on. Two clients opening the emptied body at once can each add one; that is accepted.

Not done here: table column delete still waits for a dedicated command, because its rows must stay rectangular while the targets are cells in different parents. `DeleteNodes` can carry it once the editor builds the command.
