# Inventory of `documents.content` readers (G2, issue 14)

Audited 2026-10-02 by grep over `backend/internal`, `backend/cmd`, `frontend/src`.
Rule: for a Markdown document with `root_node_id`, no reader may return or search `documents.content`.

## Backend

| Reader | File | Behavior for Markdown with AST | Status |
| --- | --- | --- | --- |
| Detail, share-token detail, duplicate source | `get_by_id_query.go`, `get_by_share_token_query.go`, `duplicate_query.go` | `CASE ... THEN ''` hides the legacy column | AST only |
| List | `list_documents_query.go` | Returns `''`; search matches `document_nodes.content` and attributes | AST only |
| List search fallback | `list_documents_query.go` | `d.content ILIKE` applies only when type is not Markdown or `root_node_id IS NULL` | Legacy compatibility read |
| Metadata update | `update_query.go` | Reads `content` only to reject a body change; legacy value is preserved | Guard, not a reader |
| Initialize body | `body_initializer.go` | Reads `content` to check the SHA-256 source fingerprint once, before the AST exists | Legacy-only, by design |
| Named snapshot | `revision_query.go` | Selects `content`, but clears `revision.Content` when the AST snapshot is stored | AST only |
| Auto revision, restore | `auto_revision.go`, `restore_revision_query.go` | AST snapshots | AST only |
| RAG index | `rag_index.go` | Builds chunks from `document_nodes` | AST only |
| Comments | anchors reference `document_nodes` | No `content` read | AST only |
| Seeders | `cmd/seeder`, `cmd/testseed` | No `documents.content` read | n/a |
| Public body | `/public/documents/{shareToken}/body` | AST snapshot | AST only |

## Frontend

| Reader | Behavior |
| --- | --- |
| `remote-markdown-doc-editor.tsx` | Falls back to `document.content` only while the body query has no data; the API returns `''` for AST documents |
| `version-history-sidebar.tsx` | Uses `revision.content` only when the revision has no `astSnapshot` |
| `public-markdown-document.tsx` | Markdown renders from the AST body; `document.content` is read for non-Markdown only |
| `doc-card.tsx`, `project-sub-card.tsx` | Thumbnail renders from the AST body for Markdown |
| `backfill-markdown-bodies.ts` | Reads legacy `content` on purpose; it is the migration reader |
| Export | No Markdown export path exists in the frontend; only DBML/Mermaid export |

## Remaining legacy reads

`documents.content` is still the source for DBML, Mermaid, and Markdown documents that have not been backfilled. The fallback for Markdown without an AST cannot be removed until every environment is backfilled (issue 15). Production data was not inventoried here.

Use `go run ./cmd/bodyaudit -workspace <uuid>` to count pending legacy documents and detect AST/CRDT inconsistencies.
