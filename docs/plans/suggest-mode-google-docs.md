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

**Status: in review.** The pure engine is in PR #83. The live editor wiring, suggestion cards, and two-user browser e2e are in the follow-up PR. The e2e covers Add, Replace, accept, reject, withdraw, live sync, canonical body, and reload. Enter and multi-line paste remain in P5; format shortcuts remain in P6.

### P4. The review rail, and the old UI goes
- Rail with cards, accept, reject, withdraw, threads, Resolve; click sync; author colors from one palette; Accept all, Reject all; preview control; viewer visibility; the index table maintained by the server.
- Remove the toolbar buttons and forms, the REST propose, accept, and reject routes, `suggestion-operations.ts`, `suggestion-draft.ts`, and `suggestionLayer.ts`. Reject legacy pending suggestions with a note in the migration.
- Done when: no path creates a suggestion except typing, and the rail shows what the e2e just created.
- UI work follows DESIGN.md and the antislop gate, including a phone-width check.

**Status: ready for review.** The server indexes suggestions from collaborative updates; REST proposal/decision code and its operation columns are removed. The rail shows author, time, replies, and synchronized highlights; viewers can read but cannot reply or resolve. The real-browser test covers accept/reject, withdraw, bulk decisions, preview, reload, and 375px width; six repeated runs passed.

### P5. Structure
- Enter split and Backspace join; multi-line paste; insert blocks (slash menu, image, table, code); delete blocks; block highlighting; accept by copy-then-delete; Accept all as one transaction plus one batch.
- Done when: a split, a join, a pasted list, an inserted table, and a deleted block each round-trip through suggest, accept, reject, and reload.
- Spike first: accepting a join and a split. If copy-then-delete loses too much (comment anchors on the originals orphan), decide before building the rest.

**Status: split and join done, most of the rest not.** Enter at the end or start of a paragraph adds an inserted paragraph; Enter in the middle splits without moving anything: the tail stays where it is, marked as deleted, and a copy of it opens an inserted paragraph (card `Split paragraph`). Backspace at the start of a paragraph, or Delete at the end of the one before, joins: the second paragraph is marked as deleted and a copy of its text is added to the first (card `Join paragraphs`). A multi-line paste at the end of a paragraph is one suggestion. Accept and reject are the ordinary decisions, so no new accept path was needed.

The spike's answer: no node moves, so no `MoveNode` is involved. The cost is that the runs that were copied (the tail on a split, the second paragraph's text on a join) get new node IDs when accepted, so a comment anchored on them would orphan. Accepted for now; P7 decides whether comments need to follow.

Not done: Enter, split and join inside lists, quotes and headings; pasting in the middle of a paragraph; splitting or joining where the text holds other suggestions or inline content that cannot be copied; inserted blocks from the slash menu (image, table, code). Those are refused with a message.

### P6. Formats and block types
- Bold, italic, strike, code, link as Format suggestions on a range; paragraph to heading, heading level, list type as block Format suggestions; cards "Format: ...".
- Done when: each is suggested, previewed in Preview accepted, accepted, and rejected.

**Status: text formats, links, and paragraph and heading types done; list types not.** Bold, italic, strike, and code on a selection are Format suggestions (card `Format: bold "text"`): the text keeps its look, carries a `suggestion_format` mark with the proposed values, and a second format on the same text joins the same card. Toggling a format the text already has proposes removing it (`remove bold`). Accept applies the values and clears the mark; reject clears the mark; Preview accepted shows the result by CSS. Your own inserted text is formatted for real. A link on a selection is a Format suggestion that holds the address (`Format: link "text"`, `Format: remove link "text"` when it proposes taking one off); only `http`, `https`, `mailto`, and paths that start with `/` or `#` are accepted; the floating toolbar now shows in Suggest mode too. A block's type is proposed too: Ctrl or Cmd plus Alt plus 0 to 6 on a paragraph or heading puts a `format` suggestion on the block (`toType`, `toAttributes: {level}`), the block keeps its type and shows a small label (`heading 2`), the card reads `Format: heading 2 "text"`, Accept converts the block (an ordinary edit, no structural command), and Preview accepted shows it at the heading size. Asking for the block's current type takes the proposal back. The slash menu and any heading buttons outside that shortcut and `editor.setHeading` still refuse in Suggest mode. The server now accepts a number in `toAttributes` (a heading level is one). Not done: list type changes.

### P7. Comments in the rail
Comments are not in the live editor today, and the old store lives in the browser only.
- Server API over the existing `comment_threads` and `comment_replies` tables; anchors to a block or range; the rail shows comments and suggestions together; Resolve for both.
- Can be dropped from this plan without blocking P1 to P6.

**Status: server API, editor, and rail done (see the frontend note below).** `GET /documents/{id}/comments`, `POST /documents/{id}/comments` (thread id from the client, so a retry is a no-op), `POST .../comments/{threadID}/replies`, `.../resolve`, `.../reopen`, over `comment_threads` and `comment_replies`. `comment_threads.anchor` (new, JSONB) holds the Yjs relative-position anchor the editor already builds. Readers can read; commenters and editors can start threads, reply, and resolve; a reply reopens a resolved thread. Not done: creating a comment from a selection in the live editor, showing threads in the rail beside suggestions, and keeping an anchor on text that a split or join copies.

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


## Remaining work: decisions

Settled in a grilling round after P7's server API. Order: P7 frontend, then the epoch fix, then P6 rest, then P5 rest. Slash-menu blocks (image, table, code) leave this plan and become their own issue, because they need asset upload and validation of an inserted block before accept.

### P7 frontend (comments in the live editor)
- Start a comment from a non-empty selection with a Comment button in the format toolbar and a shortcut. It opens an input card at the top of the rail, focused. Allowed in Edit, Suggest, and View for a user with comment or edit access; a viewer without it does not see the button.
- The rail is one list in document order, suggestions and comments together; orphaned threads last, labelled. Resolved threads and suggestions hide behind one "Show resolved" control. No filter by kind.
- Commented text gets one neutral highlight (an ink tint and a dashed underline, because DESIGN.md keeps the accent for the one key action), never an author color. Resolved threads are not highlighted. Clicking the text focuses its card and the other way round, as for suggestions.
- Only create, reply, resolve, and reopen. Edit and delete of comments become an issue. Browser-only comments from the old `comment-store` stay where they are and do not migrate.
- Other people see changes at once: a new websocket frame (`comments_changed`, no payload beyond the document) is sent to the room after a comment write, and clients refetch. It must work across instances through the existing broker. Refetch also on window focus.
- Accepting a split or join leaves comments on the copied text orphaned (see CommentAnchor).

### Epoch fix (#87)
Follows ADR 0028, for people who can suggest but not edit. Editors keep the review path: an edit aimed at a deleted block, or made offline, would otherwise merge and vanish (the first version of this fix included editors and broke the offline-rebase and collaboration e2e specs). `restore` keeps the old path.

**Status: done.** `documents.compat_epoch` (new, checked to lie between 1 and `body_epoch`; existing documents start at their current epoch). DeleteNode and MoveNode leave it alone; restore sets it to the new epoch. `CommitUpdate` accepts an update from a suggester whose epoch lies between `compat_epoch` and `body_epoch` and returns a receipt with the current epoch; `ready` and `resync` carry `compatEpoch`. The client adopts the new epoch from a `ready` or `resync` it is compatible with, or from the ack of an update the server accepted from the old epoch, re-stamps what it has not sent, and keeps going without a rebase. A pending structural command, or an edit made offline, still takes the old path. Not covered: the offline reload path (updates stored under an older epoch, read back by `start()`), and DeleteNode or MoveNode sent from an older epoch.

### P6 rest
- Links as Format suggestions on a non-empty selection, `http`, `https`, and `mailto` only, through `normalizeLinkTarget`; card `Format: link "text"`.
- Block types: paragraph to heading, heading level 1 to 6, and back, as a node suggestion of kind `format` with `toType` and `toAttributes`; the block is highlighted with its new type, and Preview accepted shows it. List type changes wait for the list work below.

### P5 rest
- Quote paragraphs behave like document paragraphs. In lists only Enter at the end of an item (an inserted item) and Backspace joining paragraphs inside one item. Splitting in the middle of an item, leaving a list with Enter on an empty item, nested lists, and tables stay refused with a message. Paste in the middle of a paragraph stays refused.

**P7 frontend status: done.** A comment starts from a non-empty selection inside one block, with Ctrl or Cmd plus Alt plus M while the editor has focus, or the Comment button at the top of the rail in any mode (View included) for someone with comment or edit access. The rail lists suggestions and comments in one list in document order, with the thread being written first and threads whose text is gone last under a `text changed` label; resolved threads hide behind "Show N resolved comments". Commented text gets the neutral mark. Other people see changes through the `comments_changed` frame (all instances, through the broker) and a refetch on window focus. Deviation from the plan: there is no Comment button in the floating format toolbar, because that toolbar exists only in Edit mode; the rail button covers every mode. A suggestion card's own thread is not hidden when it is resolved, because the suggestion it belongs to is still pending.

**P5, lists and quotes: done for the cases that need no copying.** Paragraphs inside a quote behave as in the document: Enter, a split in the middle, a join, and pasted lines. In a list, Enter at the end of an item opens the next item as an inserted list item (a task item starts unchecked); typing in it, and further Enters, stay in the same suggestion, and accepting or rejecting takes the whole item. Still refused with a message: Enter in the middle of an item or at its start with text after it, leaving a list with Enter on an empty item, joining items with Backspace, nested lists, and tables. Typing in a block you inserted, or inside an item you inserted, now belongs to that insertion.

**Comments: edit and delete, done.** The author edits their own comment or reply (`PATCH .../comments/{threadID}` and `.../replies/{replyID}`; the card says `edited` afterwards, from the new `edited_at`, because `updated_at` also moves on a reply or a resolve). The author or an editor deletes a thread (with its replies) or a reply (`DELETE`), after a confirmation that says what goes with it. Another commenter and a viewer can do neither, and nobody edits someone else's words. Both wake the room like any other comment write.

**Follow-ups #94, #95, #96: done, with two cuts.**
- #96: the REST body response now carries `compatEpoch`. On load, a user who can suggest but not edit takes the current epoch for suggestion edits saved offline under an epoch that is still compatible, instead of landing in recovery. Editors and structural commands keep the review path.
- #95: in a list, Enter in the middle of an item copies its tail into a new inserted item and proposes deleting the original tail (one split suggestion); Enter at the start of an item with text opens an inserted item above it; Enter on an empty last item of a top-level list (with other items) leaves the list: the item is proposed for deletion and an inserted paragraph follows the list (card `Leave list`); Backspace or Delete joins two single-paragraph items. Still refused with a message: items with several blocks, nested lists, leaving from the only or a middle item, and changing a list's type. The list type has no control in the editor today (no toolbar button or shortcut, only the slash menu and Markdown input), so there is nothing to attach a suggestion to; it waits for such a control.
- #94: a block from the slash menu (list, quote, code, table, divider, math, diagram) is added after the paragraph the menu was opened in, as one insert suggestion on the new block; rejecting removes it whole, accepting clears the mark. The empty paragraph stays. Heading entries propose the paragraph's level, as Ctrl+Alt+1 to 6 does. Cut: images, because the slash menu has no image entry and the orphan-asset rule is still undecided.
- Found on the way: writing a node suggestion dropped the node's own attributes (`type`, `lang`, `marker`, `loose`, heading `level`), so accepting an inserted code block was rejected by the server. `withNodeSuggestion` now keeps them.

**Urgent rule (issue #99).** Deleting must be a Seamless Edit (see CONTEXT.md): `structural deletion requires a DeleteNode command`, `Local changes need review (update-rejected)` and `Block deletion is queued` must never reach a User from an ordinary gesture, and the caret must survive a delete. Every gesture that removes a block, a line or a separator has to map to a command the editor runs behind the scenes, in Edit and in Suggest mode and in every block type. Internal errors go to the log, not to a banner.

