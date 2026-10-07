# Dokudocs

Dokudocs is a collaborative documentation app. This glossary names product concepts used across frontend and backend planning.

## Language

**User**:
A Dokudocs identity with a profile, which may participate in workspaces and own content.
_Avoid_: Account, member when referring to identity

**CurrentUser**:
The User whose identity is currently authenticated in Dokudocs.
_Avoid_: Logged user, auth user

**AccessToken**:
A time-limited credential representing a User's authenticated access to Dokudocs.
_Avoid_: Session cookie, API key

**OAuthAccount**:
An external provider identity linked to one User.
_Avoid_: Social login account, provider user

**Collaborative editing**:
Authorized users can edit the same Markdown document together, including while temporarily disconnected. Offline editing applies to existing documents the User has previously opened; DBML and Mermaid documents are outside this collaboration model.
_Avoid_: Live sync when referring only to local autosave

**DocumentBody**:
The content of a Markdown document: its Yjs state, with the ProseMirror JSON (`content_json`) and the Markdown text derived from it each time it is stored. Markdown is a way to import, export, search and preview it.
_Avoid_: Markdown text when referring to the stored representation of record

**DocumentNode**:
A block, container, or inline run within a DocumentBody, carrying a stable `nodeID` in the editor's schema.
_Avoid_: Word node

**DocumentOwner**:
A User holding a current owner grant for a Document, independent of who originally authored it.
_Avoid_: Author when referring to current ownership

**EffectiveDocumentAccess**:
The access a User has to a Document after workspace, project, document visibility, grants, draft status, and lifecycle are considered together.
_Avoid_: Document grant when referring to the final access decision

**CommentThread**:
A conversation attached to a selected range in a document, with replies and a resolution state. Anyone who can read the document sees every thread; a User with comment or edit access may start one, reply, and resolve. The author may edit their own comment or reply; the author or an editor may delete one. It is not part of the DocumentBody, so a Suggestion or an accept never touches it.
_Avoid_: Comment when referring to the full conversation rather than one message

**CommentAnchor**:
The reference connecting a CommentThread to what it discusses: a text range in a Markdown document, or an element (a node or Connection, by its id) on an Architecture canvas, where a thread whose element is removed stays readable. An anchor is a pair of Yjs relative positions, so it follows the text as it moves. It is orphaned when its text is removed or copied to new nodes (a split or join that is accepted); an orphaned thread stays readable with its quoted text, can still be replied to and resolved, and is listed last in the review rail.
_Avoid_: Character offset as a durable identity

**DocumentRevision**:
A historical snapshot of a document. Named revisions are immutable; routine automatic snapshots may be combined before they are finalized.
_Avoid_: Current document state when referring to a historical snapshot

**CollaborativeSession**:
A period when authorized Users work together on one Markdown document: a room in the collaboration service (`collab/`) and the editors connected to it, each keeping a local copy on its device.
_Avoid_: WebSocket connection when referring to the whole editing session

**LocalCopy**:
The device's own copy of a document (y-indexeddb). It lets the document open offline and keeps edits made while disconnected; the room merges them in when the connection returns. It is cleared at sign-out once the server has everything, and dropped when the server replaces the document (a restored revision).
_Avoid_: Cache when referring to unsynced edits

**Seamless Edit**:
An edit a User makes with an ordinary gesture (typing, deleting a character, a word, a line, several lines, a separator, everything; undo and redo) that never shows an internal error, a pause, a lost caret, or a request to review. Deleting and moving blocks are ordinary edits made by the editor, the only writer; there is no command to wait for. A gesture the editor cannot perform does the closest sensible thing or nothing; it never shows machine text.
_Avoid_: Showing an internal error, a queued-command message, or a review prompt for a normal gesture

**Accepted Edit**:
A change that has reached the room and is stored with the document.
_Avoid_: Received update when referring to a durable change

**Suggestion**:
A proposed change to a DocumentBody that lives in the body itself, marked with its author, until an editor accepts or rejects it. It is not part of the derived Markdown, so search, chatbot evidence, revisions, and public links never include it. Everyone who can read the document sees every Suggestion; a User with comment access may make one, and only an editor or owner may accept or reject it. The author may withdraw their own.
_Avoid_: Accepted Edit when referring to a pending proposal

**Suggestion card**:
How a Suggestion is shown in the review rail, with a title worked out from what it contains: Add (only inserted text), Delete (only deleted text), Replace (deleted and inserted text that touch), plus Format, Split paragraph, Join paragraphs, Insert block, and Delete block.

**Suggestion thread**:
The replies on one Suggestion, which can be resolved without deciding the Suggestion itself.

**Review rail**:
The right-hand column that lists Suggestion cards and CommentThreads in document order (orphaned threads last), with accept, reject, and resolve actions, and the preview of the body as if everything were accepted or rejected.

**KnowledgeSource**:
An active Markdown document, including a draft, that a User is allowed to read and that may support a chatbot answer within its workspace. Access is checked for each question; a `public_link` document without an internal grant requires a valid token proven in the current chat session. Its title and project name aid discovery; its body supplies evidence for an answer.
_Avoid_: Any document in the workspace when referring to eligible chatbot evidence

**ChatConversation**:
A private, persistent exchange between its creating User and the Dokudocs chatbot about KnowledgeSources in one workspace. The creator can read it after leaving the workspace, but cannot send new questions; it remains until the creator deletes it or the workspace is deleted.
_Avoid_: CollaborativeSession when referring to chatbot history

**GroundedAnswer**:
A chatbot response supported by KnowledgeSources available to the User when the question was asked; it retains its original text as history when those sources later change.
_Avoid_: Model-generated text without document evidence

**SourceCitation**:
A reference from a GroundedAnswer to the exact document block or section used as evidence, with the source version at answer time.
_Avoid_: Document title alone when referring to answer evidence
