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

**Status: done.** The projection skips inserted text, runs, and blocks and ignores delete and format proposals (Go and TypeScript, checked against one shared fixture); every suggestion shape is validated and an id with two authors is rejected; `SuggestionsV1` lists suggestions for P2 and P4; a suggestion update through `CommitUpdate` is stored and shared without moving `body_version` or `document_nodes`; the authenticated body carries the shared state and the public link carries the canonical body only.

Found while building it: `DeleteNode` and `MoveNode` rebuild the shared Yjs state from the canonical body, which has no suggestions, so they would erase every pending one. They now refuse with `ErrSuggestionsPending` (409) while any suggestion exists. That is only a guard. It collides with ADR 0027, where accepting a deletion uses `DeleteNodes`, so it is fixed in P1b.

### P1b. Structural commands keep the suggestion layer
- `DeleteNode`, `DeleteNodes`, and `MoveNode` apply their change to the stored Yjs document (delete or move the element by node ID) instead of rebuilding the state from the canonical body, so unrelated suggestions survive. Remove the `ErrSuggestionsPending` guard.
- Restoring a revision replaces the whole body; it drops pending suggestions by design and says so in the restore confirmation.
- Done when: with suggestions pending, deleting or moving an unrelated block leaves every suggestion intact; accepting a suggested block deletion removes the block and the other suggestions stay; the epoch behavior of ADR 0014 is unchanged.
- Backend only. Needs P1; must land before P4's accept and reject.

**Status: done.** `yjs.DeleteSubtreesV1` and `yjs.MoveSubtreeV1` edit the stored document in place and check their result against the body the command computed. A move copies the subtree, marks and suggestions included, to its new place and deletes the original in one transaction, because Yjs has no move. The two writers use them, and `ErrSuggestionsPending` is gone. Restoring a revision still replaces the whole body and drops pending suggestions on purpose: it is a wholesale replacement, so the restore confirmation has to say so (P4). The old suggestion accept (`suggestion_query.go`) still rebuilds the state with `EncodeBodyV1`; it disappears with the old model in P4.

### P2. Write path for comment-only users
- The WebSocket accepts updates from comment access under the two-part rule in "Why comment-only users need a write path". The snapshot tells the client it can suggest.
- Done when: a comment user's suggestion reaches an editor live; adversarial updates (edit canonical text, delete a canonical node, touch another user's suggestion, forge the author) are all rejected.
- Tests: Go tests for each attack, e2e with two browsers.

**Status: done on the server.** `yjs.ValidateSuggesterChange` takes the body before and after an update, removes everything the sender authored from each, and requires the two to be identical, so one comparison covers "real text and blocks are unchanged" and "no one else's suggestion is touched or forged". `CommitUpdate` applies it, plus the canonical-projection check, to users who can suggest but not edit; editors are unchanged and viewers are still refused. Per-user limits: 500 suggestions, 200,000 bytes of suggested text, 2,000 nodes in inserted blocks (growth is refused, withdrawing is never). The ready and resync frames carry `canSuggest`, a suggestion limit has its own error code `suggestion_limit`, and the room head reports `canSuggest`. Not done: the browser e2e, which belongs with the editor engine in P3.

What P3 must know:
- A text attribute holds one value per character, so a second delete mark over text another user already marked deleted would replace the first user's mark. The server refuses it. The editor treats text that is already marked deleted as deleted and adds nothing.
- Plain content inside a block the sender inserted counts as the sender's. Another user's suggestion inside that block is protected, and deleting the block while it holds one is refused.
- Content inside an inserted block is not validated as canonical content until it is accepted (the projection skips it). A suggester could park malformed nodes there; the limits bound it, and P3's accept must validate before it commits.

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
