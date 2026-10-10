---
status: accepted
date: 2026-10-08
---

# DBML and Mermaid use collaborative source text

DBML and Mermaid documents need simultaneous source editing and database-backed persistence, including unfinished source that cannot yet render. Their record will be `Y.Doc.getText('source')` in the existing collaboration service; its exact source and JSON `{ "source": "..." }` will be stored alongside the encoded state in one database transaction. Monaco binds to that shared text rather than saving a competing whole-document body.

## Considered options

- **Parser-derived AST as the record.** Parsing may fail during ordinary typing, and regenerating source could change user formatting. Diagram validity must not gate editing or persistence.
- **Whole-source REST saves or an edit lock.** A lock excludes simultaneous editing; competing whole-source saves can overwrite another user's work or pending offline edits.
- **A second collaboration service.** It would duplicate authorization, persistence, presence and device-copy lifecycle already available to Markdown and Architecture documents.

## Consequences

- Retain the existing `dbdiagram` and `mermaid` document types. DBML preview layout remains device-local; first-release collaboration applies to source, with editor/owner writes and viewer/commenter reads.
- The collaborative source is the only body writer. Existing REST metadata operations remain; full-body REST updates must not overwrite source. Parser diagnostics and previews are derived, not stored authority.
- Line endings are normalized to LF when source is created, imported or seeded. Monaco cannot hold mixed line endings, and offsets would drift between the editor and the shared text (found in the `y-monaco` compatibility spike). Everything else in the source is kept as written.
- This development instance may reset its database; legacy documents, revisions and device-only edits do not need a migration path. Fresh create/import/duplicate and empty-source initialization still require exact-source preservation.
- Restore replaces the active record and does not enter editor Undo. Historical revisions stay immutable, and pending edits from the old record are retained separately for nonblocking recovery rather than merged into the replacement.
- The replacement identity is `documents.body_replacement_id`, carried in the room name (`{workspace}.{document}.{record}`) and so in the device copy's name. The service refuses a connection to another record before taking its updates, and the API refuses a store for another record.
- A durable replacement identity must be checked before synchronization and persistence; transient reload notifications alone cannot protect against disconnected clients or stale room stores. Normal edit version increments are not replacement identities.
- Markdown and Architecture keep their current restore semantics in this feature. Shared-helper changes still require regression coverage for them.
- Reusing the session does not by itself establish PostgreSQL durability acknowledgement. Persisted source/revisions must not be described as saved solely because the room acknowledged receiving updates.

This decision extends the scope of [ADR 0029](0029-hocuspocus-and-yjs-state-replace-the-ast-stack.md) and supersedes only the DBML/Mermaid collaboration exclusion in [ADR 0001](0001-collaborative-markdown-scope.md). [The implementation plan](../plans/dbml-mermaid-collaboration.md) records the agreed scope and verification sequence. The user confirmed this design on 2026-10-08; implementation has not started.

Comments on a source were added later (#138, [ADR 0036](0036-a-mention-is-a-token-the-backend-writes.md) covers mentions in them). A thread is anchored to the words with two Yjs relative positions in `Y.Text('source')` (`{kind:"source", start, end}`), so it follows the words as the source changes and is orphaned when they are deleted. Viewing is unchanged; someone who may comment but not edit may now write comments, never source.
