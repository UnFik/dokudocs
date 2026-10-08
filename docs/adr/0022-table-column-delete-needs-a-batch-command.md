# Deleting a table column waits for a batch DeleteNode

> Superseded by [ADR 0029](0029-hocuspocus-and-yjs-state-replace-the-ast-stack.md): the AST, epochs and structural commands no longer exist.

The editor can insert tables, add rows and columns, delete rows, and set column alignment. It does not delete a single column.

Why: a column is one `table.cell` in every row, so removing it removes several unrelated subtrees. `DeleteNode` removes exactly one subtree ([ADR 0012](0012-movenode-owns-existing-node-structure.md)), the provider allows one pending structural command at a time, and every structural command starts a new body epoch ([ADR 0014](0014-structural-moves-start-body-epoch.md)). Sending one `DeleteNode` per cell would take N epochs, expose ragged tables to other clients in between, and leave a half-deleted column if the client goes offline or one command is rejected. The server does not enforce rectangular tables, so nothing would stop the bad intermediate states.

Decision: do not emulate column deletion with a sequence of single deletes. Add it when the server gains a batch `DeleteNodes` command that removes the cells atomically in one epoch. Until then, users can delete rows, or delete the whole table, which is a single subtree.

`deleteRow` on the last row removes the table through one `DeleteNode`.

Update: the batch command now exists as `nodeIDs` on the delete endpoint ([ADR 0026](0026-batch-delete-nodes.md)). Column delete is still not built; it needs the editor to send every cell of the column in one command.
