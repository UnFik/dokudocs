# Route existing-node structure changes through commands

Changing the parent or sibling order of an existing `DocumentNode` is accepted only through the validated `MoveNode` command. Deleting an existing non-root node is accepted only through `DeleteNode`; the root cannot be deleted. Ordinary Yjs updates may edit content and insert new nodes, but the server rejects a projected move, reorder, or deletion of an existing node without its matching command. This keeps structural validation, opaque-node protection, idempotent receipts, and the Yjs/AST commit in one write path.
