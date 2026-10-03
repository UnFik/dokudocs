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
The canonical structured content of a Markdown document. Markdown is a way to import or export it.
_Avoid_: Markdown text when referring to the canonical stored representation

**DocumentNode**:
A stable-identity block, container, or inline run within a DocumentBody.
_Avoid_: Word node

**OpaqueNode**:
A DocumentNode for Markdown syntax the editor cannot safely interpret. Its source must be preserved, and users cannot edit, move, reorder, or delete it.
_Avoid_: Editable raw block

**MoveNode**:
An operation that changes the parent or sibling position of an existing DocumentNode while preserving that node's identity. It must be valid against the current DocumentBody; a no-op does not change the document.
_Avoid_: Direct shared-tree mutation

**DeleteNode**:
A structural command that deletes an existing DocumentNode, commits the AST/Yjs rebuild with a durable receipt, and starts a new BodyEpoch when the tree changes.
_Avoid_: Deleting an existing node through an ordinary Yjs update

**DocumentOwner**:
A User holding a current owner grant for a Document, independent of who originally authored it.
_Avoid_: Author when referring to current ownership

**EffectiveDocumentAccess**:
The access a User has to a Document after workspace, project, document visibility, grants, draft status, and lifecycle are considered together.
_Avoid_: Document grant when referring to the final access decision

**NodePath**:
The ordered chain of ancestors that locates a DocumentNode within a DocumentBody.
_Avoid_: Canonical hierarchy

**BodySchemaVersion**:
The marker for the structural rules used to interpret a DocumentBody. A change based on incompatible rules needs review before it can be applied.
_Avoid_: BodyEpoch, BodyVersion

**CommentThread**:
A conversation attached to a selected range in a document, with replies and a resolution state. Anyone who can read the document sees every thread; a User with comment or edit access may start one, reply, and resolve. Editing or deleting a comment is not part of it yet. It is not part of the DocumentBody, so a Suggestion or an accept never touches it.
_Avoid_: Comment when referring to the full conversation rather than one message

**CommentAnchor**:
The reference connecting a CommentThread to the text range it discusses. An anchor is a pair of Yjs relative positions, so it follows the text as it moves. It is orphaned when its text is removed or copied to new nodes (a split or join that is accepted); an orphaned thread stays readable with its quoted text, can still be replied to and resolved, and is listed last in the review rail.
_Avoid_: Character offset as a durable identity

**DocumentRevision**:
A historical snapshot of a document. Named revisions are immutable; routine automatic snapshots may be combined before they are finalized.
_Avoid_: Current document state when referring to a historical snapshot

**CollaborativeSession**:
A period when authorized Users work together on one Markdown document.
_Avoid_: WebSocket connection when referring to the whole editing session

**PendingOfflineEdit**:
A change made while disconnected that has not yet become part of the canonical DocumentBody. If it cannot safely be applied to the current body, it stays available for User review.
_Avoid_: Synced edit when referring to a device-local change

**BodyVersion**:
The document's monotonically increasing identifier for each newly accepted state of its DocumentBody. Repeating the same accepted change does not represent a new version.
_Avoid_: CRDT causal clock

**BodyEpoch**:
The boundary between generations of collaborative edits. Changes from an earlier generation may require User review before they can be applied.
_Avoid_: BodyVersion, CRDT state vector

**CompatibleEpoch**:
The oldest BodyEpoch whose collaborative history still continues into the current one. A structural command that edits the stored state in place (DeleteNode, MoveNode) starts a new BodyEpoch but leaves the CompatibleEpoch alone, so an update made on an older epoch in that range still merges. A rebuild from scratch, such as restoring a revision, moves the CompatibleEpoch up to the new BodyEpoch, and older updates need review.
_Avoid_: BodyEpoch when asking whether an old update can still merge

**Accepted Edit**:
A validated change that becomes part of the canonical DocumentBody.
_Avoid_: Received update when referring to a durable change

**Suggestion**:
A proposed change to a DocumentBody that lives in the body itself, marked with its author, until an editor accepts or rejects it. It is not part of the canonical body, so search, chatbot evidence, revisions, and public links never include it. Everyone who can read the document sees every Suggestion; a User with comment access may make one, and only an editor or owner may accept or reject it. The author may withdraw their own.
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
