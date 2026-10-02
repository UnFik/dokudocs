# Plan: Suggest mode like Google Docs

Tracks [#68](https://github.com/UnFik/dokudocs/issues/68). The decision is [ADR 0027](../adr/0027-suggestions-live-in-the-body.md); terms are in `CONTEXT.md` (Suggestion, Suggestion card, Suggestion thread, Review rail).

## What it has to do

Everything in this list, except email and offline, which come later.

| Behavior | Rule |
|---|---|
| Typing in Suggest mode | Edits as usual; inserted text is underlined, deleted text is struck through, in the author's color |
| Card kinds | Add, Delete, Replace, worked out from the content. Delete then typing right at the spot (or typing then deleting next to it) is one Replace. A caret that moves, another user's edit in between, or a decision ends it. No timer |
| Own and others' edits | Editing inside your own insertion changes it; deleting your own insertion removes it. An edit inside someone else's insertion is its own suggestion and goes if the insertion is rejected |
| Enter, paste, formats, images, tables | All become suggestions: a split marker, inserted blocks, a Format card with the old and new value |
| Move a block | Delete in the old place plus insert in the new one |
| Table columns | Not suggestible yet (needs a column-delete command, ADR 0022). Rows and cells are |
| Undo and redo | Work on suggestions |
| Highlighting | A block with a suggestion is tinted and outlined in the author's color, not a left stripe (DESIGN.md) |
| Review rail | One right-hand column for suggestions and comments, in document order. Avatar, name, time, card title, Accept and Reject for editors, Withdraw for the author, thread replies, Resolve. Clicking a card scrolls to and highlights its text, and the other way round |
| Bulk | Accept all and Reject all with a confirmation that shows the count; conflicted ones are skipped and listed |
| Preview | Show suggestions, Preview accepted, Preview rejected: a read-only segmented control in the rail header |
| Visibility | Everyone who can read sees all suggestions. Viewers cannot decide or reply. A public link shows the canonical body only |
| Colors | One palette for cursors, avatars, and suggestions, keyed by user. The color is used for lines, outlines, and card edges, never as text color |
| Removed | The toolbar buttons (Suggest change, bold, italic, move up and down, insert below, delete block) and their forms |

## Design in one page

- A suggestion is a `suggestion` attribute on a run or block, holding the author and, as needed, an insert part, a delete part, or a format part with the proposed value. Backend validation already accepts any string attribute on a run; blocks need the key allowed. The Yjs projection (`projectMarks`) needs to carry it.
- Enter in Suggest mode inserts an inline split marker; Backspace at the start of a paragraph marks the paragraph as a join. Accepting either copies the affected runs into the new shape and deletes the originals with the batch `DeleteNodes`.
- The projection to `document_nodes` skips inserted content and ignores deletes and proposals, so everything that reads the body is unchanged.
- A comment-only user can send a Yjs update, but only a suggestion-shaped one (see below).

## Why comment-only users need a write path

Comment access means a user can suggest but cannot decide: they cannot accept, reject, or edit the real text. That does not change.

What changes is how a suggestion reaches the server. Today it is a separate REST call (`POST /suggestions`) into its own table, so a comment-only user never writes to the document, and the server refuses every Yjs update from anyone without edit access. Under ADR 0027 a suggestion is content of the document itself: when a commenter types in Suggest mode, their browser sends a Yjs update to the shared body. The server has to accept that update, and it must accept nothing else from them. The rule:

1. After the update, the canonical projection (`document_nodes`) must be identical to before. They cannot change, delete, or reorder real text or blocks.
2. The update may only add, change, or remove suggestions authored by the sender. They cannot touch another user's suggestion, and the author recorded on a suggestion must be the sender.

Still not allowed for a comment-only user: accepting or rejecting (editors only; the author may withdraw their own), and anything that edits canonical content. Replies and Resolve stay REST calls as today. Resolve closes a discussion, it does not decide a suggestion.

This rule is the only thing between a commenter and the shared body, so P2's adversarial tests (edit canonical text, delete a canonical node, touch someone else's suggestion, forge the author) must pass before P3 starts.
- The editor rewrites each local transaction in Suggest mode into marks (a track-changes plugin). Accept and reject are normal edits by an editor.
- The server keeps an index row per suggestion by reading Yjs updates. Replies and Resolve keep their tables.

## Phases

Each phase is one or more PRs, merges on its own, and ships with an e2e that drives a real browser, editor, WebSocket, and server and reloads the page to check the server state. Component tests alone were not enough for the delete gestures, so none of these counts as done on them.

### P1. Marks in the body, invisible to everything else
Schema and projection only, no UI.
- PM marks and the block attribute; backend allows the keys; Yjs projection carries them.
- Projection to `document_nodes` skips inserts and ignores deletes and proposals.
- Done when: a body full of suggestions yields exactly the canonical `document_nodes`; search, RAG, revisions, duplicate, and public link tests show no suggestion text.
- Tests: Go projection unit tests for every kind, integration test through the real commit path, codec round trips.

### P2. Write path for comment-only users
- The WebSocket accepts updates from comment access under the two-part rule in "Why comment-only users need a write path". The snapshot tells the client it can suggest.
- Done when: a comment user's suggestion reaches an editor live; adversarial updates (edit canonical text, delete a canonical node, touch another user's suggestion, forge the author) are all rejected.
- Tests: Go tests for each attack, e2e with two browsers.

### P3. Track-changes engine for text
- Insert, delete, replace marks; the grouping rules; own and others' insertions; single-line paste; undo and redo; own-edit merging.
- Done when: the three card kinds appear from real keystrokes, an editor accepts and rejects, and the server body and a reload agree.
- Tests: unit tests per ProseMirror step type and per grouping rule; e2e with a commenter and an editor.

### P4. The review rail, and the old UI goes
- Rail with cards, accept, reject, withdraw, threads, Resolve; click sync; author colors from one palette; Accept all, Reject all; preview control; viewer visibility; the index table maintained by the server.
- Remove the toolbar buttons and forms, the REST propose, accept, and reject routes, `suggestion-operations.ts`, `suggestion-draft.ts`, and `suggestionLayer.ts`. Reject legacy pending suggestions with a note in the migration.
- Done when: no path creates a suggestion except typing, and the rail shows what the e2e just created.
- UI work follows DESIGN.md and the antislop gate, including a phone-width check.

### P5. Structure
- Enter split and Backspace join; multi-line paste; insert blocks (slash menu, image, table, code); delete blocks; block highlighting; accept by copy-then-delete; Accept all as one transaction plus one batch.
- Done when: a split, a join, a pasted list, an inserted table, and a deleted block each round-trip through suggest, accept, reject, and reload.
- Spike first: accepting a join and a split. If copy-then-delete loses too much (comment anchors on the originals orphan), decide before building the rest.

### P6. Formats and block types
- Bold, italic, strike, code, link as Format suggestions on a range; paragraph to heading, heading level, list type as block Format suggestions; cards "Format: ...".
- Done when: each is suggested, previewed in Preview accepted, accepted, and rejected.

### P7. Comments in the rail
Comments are not in the live editor today, and the old store lives in the browser only.
- Server API over the existing `comment_threads` and `comment_replies` tables; anchors to a block or range; the rail shows comments and suggestions together; Resolve for both.
- Can be dropped from this plan without blocking P1 to P6.

## Risks

- **The write rule is the security boundary.** A comment-only user writes into the shared body. It is P2's whole job, and P3 does not start until its adversarial tests pass.
- **Accepting a deletion that removes a whole run or block starts a body epoch** (ADR 0014) and invalidates other people's pending local work. Accept all keeps it to one. Expect review prompts for concurrent offline edits, which exist already.
- **Body growth.** Unreviewed suggestions stay in the Yjs state. A cap per user and per document, and a warning in the rail, are needed before this meets large documents (ADR 0023).
- **Copy-then-delete on split and join** changes node IDs, so comments anchored to the originals orphan. P5's spike decides whether that is acceptable.
- **Position of cards.** Google aligns each card with its text. P4 ships an ordered list with scroll sync; aligned cards are a later refinement, not a blocker.

## To settle inside a phase, not now

- Whether the index records accepted versus rejected, or only closed, when a suggestion disappears (P4).
- Size and count limits on suggestions (P2).
- Exact copy and keyboard shortcuts for the rail (P4).

## Out of scope

Email notifications, in-app notifications, offline suggestions, table column suggestions.
