# Suggest mode is a typing layer over stored suggestions

Suggest behaves like Google Docs: the user keeps editing, and the edits become suggestions that an editor later accepts, rejects, or resolves. Storage does not change. Suggestions stay in `document_suggestions`, outside the Yjs body and the canonical AST, as ADR 0006 requires. Inline marks in Yjs were considered and rejected because they would put unapproved text into the Markdown export, RAG evidence, and the offline conflict flow.

**Typing.** In Suggest mode a typed edit is no longer reverted and refused. The editor shows it in place as an insertion or a struck deletion, in a local layer that never reaches Yjs. Consecutive edits by one author in adjacent text merge into one suggestion; moving the caret elsewhere starts a new one. Delete-then-type is one "replace" card. The one-run limit of `translateTextEdit` is lifted for inline text and inline formatting. Block structure still goes through the panel builders.

**Review.** An editor accepts or rejects a suggestion. The proposer may withdraw their own. Replies live in a new thread table keyed by suggestion. Resolve closes the thread, never touches text, and is allowed while the suggestion is pending. A suggestion whose whole range was deleted by other edits closes as obsolete. Rejecting an insertion also rejects suggestions made inside it. A suggestion that fails revalidation stays `conflicted` and can only be rejected or closed; there is no automatic rebase.

**Kept from earlier decisions.** Suggestions are visible only to their proposer and eligible editors (ADR 0006). Suggest is online-only, and the mode is stored per user in localStorage. Notifications are in-app: a new suggestion goes to the owner, a decision goes to the proposer. No email.

**Cost.** The editor needs a local suggestion layer and a merge step for typed edits, and the thread table is new. In exchange the model, permissions, and acceptance path stay as they are.
