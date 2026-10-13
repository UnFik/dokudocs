# The Agent edits Architecture documents with operations the User approves first

The Agent reads an Architecture document as its canvas in JSON (every node and Connection with its id, parent and place) and changes it with `edit_architecture`: add, update, move and remove nodes, add, update and remove Connections, and link or unlink documents. Operations run in the collaboration service on a copy of the canvas and land together or not at all, using the same functions the editor uses, so the layout rules and the limits of 500 nodes and 1000 Connections hold for the Agent too. In chat the User approves first (a canvas has no Suggestions to review), and the card shows a summary the server wrote from the operations, not the model. Through MCP an editor's change goes straight in, as it does for DBML and Mermaid, after a named revision made first. Only someone who can edit may do this: a person who can only suggest or comment has no path to a canvas.

This replaces the sentence in [ADR 0043](0043-agent-writes-follow-the-users-own-document-rights.md) that kept Architecture documents read-only. The risk it named, one wrong operation breaking a diagram, is answered by the all-or-nothing call, the approval, and the revision that undoes it.

## Considered Options

- **Suggestions for canvas changes.** Safest, but a whole new model (proposed elements, accept and reject) for a feature the approval card already covers.
- **Writing Yjs fields directly.** Fewer moving parts, but it would copy the editor's layout and nesting rules and drift from them.
- **Letting the model describe the change on the approval card.** A model that misstates a deletion defeats the point of asking.

## Consequences

- The version an edit names is a fingerprint of what the diagram says, without the x, y, width and height of boxes. A person nudging a Host does not void a change waiting for approval; renaming or rewiring does. This differs from the text documents, whose version covers all of the text.
- Removing a Host or Group that holds elements is refused unless the call says `cascade: true`, and the approval card names how many Systems and Connections go with it.
- The catalog slug of a node and the protocol of a Connection are checked against the catalog before anything is sent; a wrong slug comes back with the nearest ones. Linking a document is allowed only for a document in the same workspace that the User can read, because the link would otherwise let the Architecture version snapshot content the User cannot see (ADR 0032).
- A node added in a call may be named by a `ref` so a Connection in the same call can use it; the answer maps each ref to the id it became.
