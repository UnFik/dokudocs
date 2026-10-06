# Build the collaborative editor on the ProseMirror ecosystem, not Muya

The collaborative Markdown editor stays on ProseMirror with `y-prosemirror`, and the rich-text experience (undo/redo, shortcuts, toolbar, lists, tables, clipboard) is built on the ProseMirror packages (`prosemirror-keymap`, `-commands`, `-inputrules`, `-schema-list`, `-tables`). Muya is not rebound to Yjs.

Why: the shared model, node IDs, `MoveNode`/`DeleteNode` commands, node-ID rebase ([ADR 0015](0015-rebase-pending-edits-by-node-id.md)), comment anchors, and server validation all assume a ProseMirror-shaped tree whose marks are run attributes. Muya keeps inline marks as Markdown syntax inside block text and has no Yjs binding, so using it would need a custom two-way translation of its OT operations plus its own multi-user undo. The spike plan already listed that binding as unproven.

Cost accepted: the editing experience Muya provides today has to be rebuilt for the new editor, tracked as gate G7 in `docs/plans/dokudocs-refactor-gap-closure.md`.

Reference: Outline (`references/outline`) builds its editor the same way. Its license is Business Source License 1.1, so it is a design reference only: read it to learn which behaviors matter, and write our own implementation from the public ProseMirror APIs. Do not copy its code.
