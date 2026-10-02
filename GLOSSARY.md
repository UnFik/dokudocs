# Dokudocs

A technical documentation system: people write Markdown together in real time, like Google Docs, and review each other's changes without losing work.

## Language

**Suggestion**:
A proposed change to a document that waits for an editor to accept or reject it. It does not change the document until it is accepted.
_Avoid_: Comment, edit request, AI edit

**Mode**:
How a person works with an open document: View, Edit, or Suggest.
_Avoid_: Tab (that is the control, not the concept), state

**Pending edit**:
A change a person has typed that the server has not accepted yet. It stays on the device and is sent again until the server accepts it.
_Avoid_: Unsaved change, draft, local change

**Held edit**:
A pending edit that cannot be sent again automatically. It is kept so nothing is lost until a person decides what to do with it. People should never meet it in ordinary editing.
_Avoid_: Conflict, review, rejected edit
