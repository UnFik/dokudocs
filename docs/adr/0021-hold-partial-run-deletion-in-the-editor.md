# Hold deletion of a run's last character in the editor

> Superseded by [ADR 0029](0029-hocuspocus-and-yjs-state-replace-the-ast-stack.md): the AST, epochs and structural commands no longer exist.

The editor guard `wouldRemoveInlineRun` in `createDocumentBodyEditor.ts` drops a local transaction that would empty or remove an inline run while its parent block survives. A run's ID is replicated state; letting ProseMirror delete it would either lose the ID or need a `DeleteNode` for a node the user did not mean to delete.

Two gestures are therefore separate:

- Backspace or Delete on a fully selected block sends `DeleteNode` for that block ([ADR 0016](0016-reissue-structural-commands-across-body-epoch.md) covers replay). The key handler runs before the guard.
- Removing only the last character of a run is held: no request, no Yjs change, no error. The user's text stays unchanged.

Tests: `documentBody.spec.ts` covers the held case, the Backspace gesture on a selected paragraph, and the `Alt+ArrowDown` MoveNode gesture. Browser proof is `markdown-collaboration.spec.ts` and `markdown-offline-rebase.spec.ts`.

Open: a run reduced to empty text could instead be removed through a dedicated inline command. Not decided here.
