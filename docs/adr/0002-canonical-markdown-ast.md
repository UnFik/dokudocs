# Make the Markdown AST canonical for collaborative editing

> Superseded by [ADR 0029](0029-hocuspocus-and-yjs-state-replace-the-ast-stack.md): the AST, epochs and structural commands no longer exist.

Markdown documents persist as a relational AST; Markdown remains a human-readable import/export format. A ProseMirror-style document tree bound to Yjs-compatible shared types carries collaborative edits, and the server transactionally projects each accepted update into the relational AST. PostgreSQL stores both the encoded CRDT state and affected AST nodes before ACK, serialized per document. Browser IndexedDB retains unsynced state across offline periods until durable server ACK. Defer an append-only operation log until measured scale or audit needs justify it. Runtime choice remains a spike decision; production readiness requires load and failover gates.
