# Cache the committed body and Yjs document per document

A collaborative commit used to cost time linear in document size on every keystroke: reading the stored Yjs state and every node row, projecting the stored state again to prove rows and state agree, decoding the state, validating the whole body four times, rewriting the rolling auto revision, and compressing the state on write.

Each server instance now keeps, per document, the Yjs state, the decoded Yjs document, and the node rows of its last successful commit. The entry is keyed by root node, `body_version`, `body_epoch`, schema version, and `document_collab_states.revision`. A database trigger bumps `revision` on every write to the state, so a commit from another instance or from another writer (DeleteNode, MoveNode, restore, suggestion acceptance, initialization) always changes the key. A commit reads the key under the document row lock that serializes writers. When the key matches, the commit skips the reads and the consistency projection and applies the update to the cached document. When it does not match, the commit takes the full read path, including the consistency check. With diff writes that check is what repairs a divergence between rows and state, so it must never be skipped without a matching key.

The decoded document is borrowed exclusively for one commit and returned to the cache only after the transaction commits. After a failed commit it may hold an update the database never accepted, so it is discarded. The cache is a 32-document LRU per instance.

Validation of a Yjs edit uses `documentbody.ValidateCollaborativeChange`. It accepts exactly what the full checks accept together but parses attributes and compares sibling order only for the nodes the edit touched.

The rolling auto revision is rewritten at most once per 10 seconds per document by collaborative commits. It may therefore trail the live body by up to 10 seconds; structural commands, restore, and suggestion acceptance still write it every time. The Yjs state column is stored without pglz compression because it is rewritten on every commit.

Not done: projection of the merged document is still a full walk (about 9 ms at 2,000 nodes) and the full state is still encoded and written per commit.
