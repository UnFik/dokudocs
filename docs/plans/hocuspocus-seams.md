# Seams for the Hocuspocus implementation

Tests live only at these boundaries (TDD, one slice at a time). They come from the exit criteria agreed in issue #106 and `hocuspocus-yjs-state.md`.

| Seam | Interface | What a test observes |
|---|---|---|
| S1 Collaboration service | WebSocket (Hocuspocus provider to server) plus the `BackendApi` boundary it calls | two clients converge; a viewer cannot write; an unauthorized token is refused; the state and derived JSON are stored when the room empties; a suggester's change is accepted or refused |
| S2 Go internal API | HTTP `/internal/collab/*`, secret header | authorize returns the user's access; load returns the stored state; store writes `state` and `content_json` in one transaction |
| S3 Suggestion validator | pure function: document before, update, sender, access | the cases of the Go suggestion tests, ported (own suggestion ok; canonical text, someone else's suggestion, forged author refused) |
| S4 Editor in the browser | Playwright against the built app | delete a line, delete all, undo after delete, paste the PRD fixture, offline edit then reconnect, suggestions, no internal error shown |
| S5 Consumers | Go HTTP API (search, export, duplicate, list, RAG) | the response for a document whose only content is `content_json` |

Not tested: Hocuspocus internals, ProseMirror internals, the Go store beyond S2.
