# Hocuspocus and Yjs state replace the AST collaboration stack

A document is its Yjs state. A Node service (`collab/`, Hocuspocus) holds the rooms, authenticates each connection against the Go API, and stores the state together with the ProseMirror JSON derived from it (`documents.content_json`) and a Markdown text derived from that (`documents.content`). Go no longer reads or validates Yjs updates, and the relational AST (`document_nodes`) is gone.

Why: every ordinary gesture that touched structure (delete a line, move a block, paste, undo after a delete, offline edits that met a restore) needed its own command, epoch rule and review path, and each of those once showed a machine message to the person typing. With the editor as the only writer and the server only relaying and storing, those paths do not exist. Deleting and moving a block are plain edits.

What replaced what:

- Rooms, auth, persistence: `collab/` (Hocuspocus). Access comes from `POST /internal/collab/authorize`, state from `GET`/`PUT /internal/collab/document`, both behind a shared secret.
- The editor opens a `HocuspocusProvider` with a y-indexeddb copy, so a document opens offline and keeps unsynced edits. Presence and cursors are awareness. Comment changes and "this document was replaced" are stateless messages.
- Suggest mode stays ([ADR 0027](0027-suggestions-live-in-the-body.md)). What someone who can only suggest may write is checked in the service before it is applied (`collab/src/suggestion-validator.ts`): canonical text must stay as it was and every suggestion mark must carry their own name.
- Search, RAG, duplicate, export, list and public links read `documents.content` (derived Markdown) and `content_json`. Revisions snapshot `content_json`. A restore writes the JSON, drops the stored state and asks the service to reload the room; the service rebuilds the state from the JSON the same way every time, so a device that kept an earlier copy does not end up with the document twice.
- Underline and highlight are exported to Markdown as inline HTML (`<u>`, `<mark>`).

This supersedes the AST, epoch and structural-command decisions: ADRs 0002, 0003, 0007, 0008, 0009, 0010, 0012, 0013, 0014, 0015, 0016, 0017, 0021, 0022, 0026 and 0028. The Outline source was read for behavior only (its license forbids copying code); the pieces used are Hocuspocus, y-prosemirror and y-indexeddb, all MIT.
