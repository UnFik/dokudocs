# Remote cursors are ephemeral and share only a name and a color

A collaborator's cursor and selection reach the other people editing the same document, and nothing more.

- **Who sees it:** only connections that already passed the document access check on the collaboration socket, and that opted in with the `cursor` capability. A revoked user is disconnected by the existing session check, so they stop receiving and sending cursors with their access.
- **What is shared:** the display name and a color. The color is derived from the user ID on the server, so it is stable across tabs and sessions without being stored. Email, avatar, role, and any other profile field are never put in a cursor frame; the client also copies only the known fields out of a frame it receives.
- **What the position is:** two Yjs relative positions (anchor and head), at most 256 bytes each. They stay valid while other people edit, and they say nothing about the document beyond a location.
- **Lifetime:** the server relays frames and keeps no copy. Nothing is written to PostgreSQL, Redis, or IndexedDB. A cursor disappears on `cursor_leave`, when the owner's socket closes, when the editor loses focus, and on the receiving side when its own connection drops.
- **Back pressure:** a frame is dropped when a peer's outgoing queue is full. The next selection change replaces it. The client sends the first change at once and then at most one every 100 ms.
- **Older clients:** a client that did not announce `cursor` never receives these frames, as with `presence`.

Not covered: cursors are relayed within one server instance. The Redis broker carries document updates only, so two users connected to different instances do not see each other's cursor yet. Presence has a shared store for this; cursors would need a broker channel with the same privacy limits.
