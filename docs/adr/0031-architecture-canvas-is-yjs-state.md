# An Architecture document is Yjs state in the same collaboration service

An Architecture document (a React Flow canvas of Hosts, Systems and Connections) is a new `document_type`, `architecture`, and its record is Yjs state held in a `collab/` room, the same way a Markdown document is ([ADR 0029](0029-hocuspocus-and-yjs-state-replace-the-ast-stack.md)). Nodes and edges are Yjs maps keyed by a stable ID; the canvas JSON stored in `documents.content_json` is derived from that state each time it is saved, and search, RAG, revisions and export read the JSON. Auth, rooms, presence, the local copy on the device and restore come from the existing service instead of a second sync path.

## Considered Options

- **A JSON blob saved by the API, with an edit lock.** Simplest, but only one person edits at a time, which the product baseline does not accept.
- **Relational tables for nodes and edges.** Queryable, but every move and reparent would need its own command and merge rule: the path ADR 0029 removed for Markdown.

## Consequences

- ADR 0001's line "DBML and Mermaid remain text documents" is unchanged; this ADR only brings Architecture documents into the collaboration model.
- Besides `content_json`, each store derives a text summary (`documents.content`, for search and RAG) and the `architecture_document_links` rows (for "Used in" and access checks). Both can be rebuilt from `content_json` and are never written any other way.
- Catalog entries are referenced from the canvas by a stable slug (`golang`, `postgresql`, `grpc`), not by a database ID, so the derived JSON stays readable and survives a reseeded catalog.
