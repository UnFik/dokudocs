# Durable receipts make structural command retries safe

> Superseded by [ADR 0029](0029-hocuspocus-and-yjs-state-replace-the-ast-stack.md): the AST, epochs and structural commands no longer exist.

Dokudocs assigns each `MoveNode` and `DeleteNode` a document-scoped command ID and commits its receipt in the same PostgreSQL transaction as the structural change. A receipt binds the original body epoch, actor, request hash (including the command kind), result, and body version. After checking current edit access, the server looks up the receipt before checking the current epoch: an identical retry returns the original result, while reuse by another actor or with a different epoch or payload is rejected. Keep receipts until permanent document deletion; a command that did not commit has no receipt, and user resolution creates a new command ID. This keeps a lost ACK from applying a structural change twice, including when a restore or later structural command starts a new epoch before retry.
