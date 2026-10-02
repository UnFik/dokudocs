# G7 parity inventory: Muya editor vs collaborative editor

Issue #27. Reference for issues #28 to #35. Engine decision: [ADR 0018](../adr/0018-prosemirror-ecosystem-for-the-collaborative-editor.md) (ProseMirror ecosystem, Muya is not rebound to Yjs).

Outline (`references/outline`) is licensed BSL 1.1: behavior reference only, no code is copied.

## Method

- Muya column: read from `frontend/src/features/docs/lib/muya` (blocks, `ui/*` plugins and their `config.ts`, `clipboard`, `history`) and `components/muya-editor/MuyaEditor.tsx`, which registers the plugins.
- Collaborative column: read from `frontend/src/features/docs/lib/prosemirror`. The editor mounts `ySyncPlugin` and `yUndoPlugin` only. `documentBodySchema` has every node type but only five marks: `strong`, `em`, `strike`, `code`, `link`. Marks live in run attributes (`bold`, `italic`, `strike`, `code`, `href`, `linkTitle`) and server validation (`backend/internal/domain/documentbody/body.go`) accepts only those inline attributes.
- Decisions: **carry** (build in G7), **defer** (after G7, needs a server or schema change or has low use), **drop** (not rebuilt).

## State today

| Capability | Collaborative editor today |
|---|---|
| Undo / redo | `editor.undo()` / `redo()` exist and are tested (local undo skips remote edits). No button, no shortcut, no enabled state. |
| Inline formatting | Marks render. No shortcut, no toolbar. |
| Block input rules, list keys | None. Only `Alt+Up/Down` (block move) and Backspace/Delete on a fully selected block (DeleteNode). |
| Tables | Schema nodes only. No commands, no UI. |
| Clipboard | ProseMirror default (HTML slice). No Markdown paste or copy. |
| Images, math, diagrams | Render as placeholder (`[image]`) or plain text content. No editing UI. |

## Inventory

| # | Feature (Muya) | Muya source | Decision | Target issue | Notes |
|---|---|---|---|---|---|
| 1 | Undo / redo (Ctrl/Cmd+Z, Shift+Z, Ctrl+Y) and `canUndo` / `canRedo` | `history`, `MuyaEditor` handle | Carry | #28 | Per-user undo through `yUndoPlugin`. Button state from the undo manager stacks. |
| 2 | Bold, italic, strikethrough, inline code (`strong`, `em`, `del`, `inline_code`) | `inlineFormatToolbar/config.ts` | Carry | #29 | Ctrl/Cmd+B, I, Shift+X (strike), E (code). Changes must keep run IDs stable. |
| 3 | Link (add, edit, remove) | `linkTools`, toolbar `link` | Carry | #29 | Toolbar button and Ctrl/Cmd+K. The `link` mark already maps to `href` / `linkTitle`. |
| 4 | Floating selection toolbar | `inlineFormatToolbar` | Carry | #29 | Appears on non-empty text selection. |
| 5 | Clear formatting (`clear`) | toolbar `clear` | Carry | #29 | Removes the five known marks from the selection. |
| 6 | Underline (`u`), highlight (`mark`) | toolbar `u`, `mark` | Defer | none yet | Not in `documentBodySchema`, and the server rejects unknown run attributes. Needs an ADR and a backend allow-list change. |
| 7 | Inline math toggle (`inline_math`) | toolbar `inline_math` | Defer | #33 | Inline `math` node exists; the editing UI belongs with math. |
| 8 | Inline image toggle | toolbar `image`, `imageToolbar` | Defer | #33 | See images below. |
| 9 | Inline comment button | toolbar `comment` | Carry (existing) | already live | Comment anchors already work through `createAnchor`. Wiring the button into the new toolbar is a #29 follow-up, not a new feature. |
| 10 | Heading via `# ` input rule, levels 1 to 6 | `atxHeading`, front menu | Carry | #30 | Must write `level` into `bodyAttributes`; the server requires it. |
| 11 | Bullet list `- `, ordered `1. `, task `[ ] ` | `bulletList`, `orderList`, `taskList` | Carry | #30 | Server requires `marker`, `loose`, `start`, `delimiter`, `checked`. |
| 12 | Blockquote `> ` | `blockQuote` | Carry | #30 | |
| 13 | Code block ```` ``` ```` with language | `codeBlock`, `codeBlockLanguageSelector` | Carry (block) / Defer (language picker) | #30 / #33 | Fence input rule in #30. Language picker later. |
| 14 | Thematic break `---` | `thematicBreak` | Carry | #30 | Node carries `bodyContent`. |
| 15 | List indent, outdent, Enter, Backspace | `listItem` key handling | Carry | #30 | `prosemirror-schema-list`. |
| 16 | Setext headings | `setextHeading` | Drop for authoring | none | Still rendered and preserved; new headings are ATX. |
| 17 | Paragraph front button and turn-into menu | `paragraphFrontButton`, `paragraphFrontMenu` | Defer | #34 | Replaced by slash menu and drag handle. |
| 18 | Quick insert menu (`@` / `/`) | `paragraphQuickInsertMenu` | Defer | #34 | |
| 19 | Table: insert grid, row/column menu, drag bar, column toolbar, alignment | `tableChessboard`, `tableRowColumMenu`, `tableDragBar`, `tableColumnToolbar` | Defer | #31 | `prosemirror-tables`; alignment maps to the server `align` choice. |
| 20 | Paste Markdown / HTML, paste image, copy as Markdown, cut | `clipboard/*` | Defer | #32 | |
| 21 | Image: insert, edit, resize, align, remove, path picker | `imageEditTool`, `imageResizeBar`, `imageToolbar`, `imagePicker` | Defer | #33 | |
| 22 | Math block, diagram preview (mermaid, vega-lite, plantuml, flowchart, sequence) | `extra/math`, `extra/diagram`, `previewToolBar` | Defer | #33 | Nodes exist as text content. |
| 23 | Footnote tool | `footnoteTool` | Defer | none yet | `footnote` node exists; low use. |
| 24 | Emoji selector | `emojiSelector` | Drop | none | Native OS emoji input works with ProseMirror. |
| 25 | Frontmatter block | `extra/frontmatter` | Carry (preserve) | none | Node round-trips already; no new UI. |
| 26 | Search / replace | `search` | Defer | none yet | |
| 27 | TOC and heading copy-link | `MuyaEditor` TOC, `headingCopyLink` | Defer | none yet | |
| 28 | IME composition, keyboard access, narrow-screen toolbar | Muya internals | Carry | #35 | Verify every G7 control against it. |
| 29 | Muya `Ctrl+Z` history | `history` | Drop | n/a | Replaced by item 1. |

## Cross-cutting constraints for #28 to #35

- Every command must dispatch an ordinary ProseMirror transaction so `prepareBodyTransaction` assigns node IDs and rejects invalid structure. No command may bypass `dispatchTransaction`.
- A mark change splits a run: the first part keeps the node ID, the rest get new IDs (`splitRunsWithMixedMarks`).
- Block-type changes must write the attributes the server requires (see items 10 to 11).
- Controls respect `readOnly` and the structural-command pause (`editable()`).
- UI follows `DESIGN.md`: ghost toolbar buttons with `aria-label`, Lucide icons at 16px, 4px radius, one small shadow on the floating layer, no accent fill.

## Status of #28 to #30 and the structural-command limit

Done in the editor (`frontend/src/features/docs/lib/prosemirror`):

- #28: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y; undo and redo buttons with enabled state from the Yjs undo manager; a two-editor test proves undo reverts only the local edit.
- #29: Ctrl/Cmd+B, I, E, Shift+X, K; floating selection toolbar (bold, italic, strike, code, link); a mark change splits the run in place, the first part keeps its ID and the rest get fresh IDs.
- #30 (part): heading by `Ctrl+Alt+1..6` and `Ctrl+Alt+0`, heading input rule `# `, Enter in paragraph, heading, bullet item and task item, `Ctrl/Cmd+Enter` to toggle a task item.

Not done in #30, and why. [ADR 0012](../adr/0012-movenode-owns-existing-node-structure.md) and `prepareBodyTransaction` reject any local transaction that reparents or deletes an existing node unless it goes through `MoveNode` or `DeleteNode`. That blocks these behaviors until a command exists for them:

- Wrapping a paragraph in a list or quote (`- `, `1. `, `[ ] `, `> `): the paragraph changes parent.
- Indent, outdent, and Backspace at the start of a list item: the item or its paragraph changes parent.
- Code block (```` ``` ````) and horizontal rule from a paragraph: the run children are replaced, which deletes run nodes.
- `# ` in an empty paragraph: removing the marker empties the only run, and `wouldRemoveInlineRun` blocks it.

A way forward is a server `ConvertBlock` command (change a block's type and wrap or unwrap it while keeping descendant IDs), or sequencing existing `MoveNode` calls with the editor paused. Either needs an ADR. The server also requires per-type attributes (`marker`, `loose`, `start`, `delimiter`, `checked`, `level`), so any new block command must write them.

Update: code block and horizontal rule are available as insert-new-sibling commands (`Ctrl/Cmd+Alt+C`, `Ctrl/Cmd+Alt+-`), which add a node under an existing parent and need no server command. Wrap, indent, outdent, and convert-in-place need new server commands, proposed in [ADR 0024](../adr/0024-proposal-block-conversion-commands.md). The two-client E2E for #28 is `e2e/ui/specs/smoke/markdown-undo.spec.ts`.
