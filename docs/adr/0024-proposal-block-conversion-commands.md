# Proposal: block conversion commands for lists, quotes, and indentation

Status: proposed. Nothing in this ADR is implemented. It needs an owner decision before any server or editor work.

## Problem

Gate G7 asks the collaborative editor for `- `, `1. `, `[ ] `, `> `, triple-backtick and `---` input rules, plus indent, outdent, and Backspace in lists (issue #30). [ADR 0012](0012-movenode-owns-existing-node-structure.md) accepts a change of parent, order, or deletion of an existing node only through `MoveNode` and `DeleteNode`. Each of those commands starts a new BodyEpoch ([ADR 0014](0014-structural-moves-start-body-epoch.md)). The editor therefore blocks these edits today:

| User action | What changes structurally | Why it is blocked |
|---|---|---|
| `- ` / `1. ` / `[ ] ` / `> ` on a paragraph | Paragraph gains a new parent (list item or quote) | Reparent of an existing node |
| Tab / Shift+Tab on a list item | Item moves under a sibling item's new nested list, or out of it | Reparent |
| Backspace at the start of a list item | Item is lifted out of the list | Reparent |
| Triple backtick on a paragraph | Run children become the text of a code block | Run nodes deleted |
| `# ` or `---` in an empty paragraph | The only run is emptied | Run deleted (`wouldRemoveInlineRun`) |

What does work without new commands (shipped): in-place paragraph to heading conversion, inserting a new code block or horizontal rule as a new sibling, Enter in paragraphs, headings, and list items.

## Proposed commands

All three are server-ordered, validated by `documentbody`, idempotent through a durable receipt ([ADR 0009](0009-durable-movenode-receipts.md)), start a BodyEpoch, and are re-issued across epochs under [ADR 0016](0016-reissue-structural-commands-across-body-epoch.md). Opaque nodes keep the protection of `MoveNode`: a command that would wrap, move, or change one is rejected.

1. **`WrapNodes { commandID, bodyEpoch, nodeIDs[], container }`**. `nodeIDs` are contiguous siblings. The server creates one new container node (`bullet-list` with a `list-item`, `order-list` with a `list-item`, `task-list` with a `task-list-item`, or `block-quote`) at their position and makes them its children, with the per-type attributes the validator requires (`marker`, `loose`, `start`, `delimiter`, `checked`). The wrapped nodes keep their IDs. Covers `- `, `1. `, `[ ] `, `> `.
2. **`UnwrapNode { commandID, bodyEpoch, nodeID }`**. Replaces a container (list item, quote) by its children in the parent, removing the container and any list left empty. Children keep their IDs. Covers Backspace at list start and Shift+Tab at depth 1. Outdent at depth greater than 1 is `UnwrapNode` of the nested list's item followed by a server-side merge into the parent list.
3. **`ConvertBlock { commandID, bodyEpoch, nodeID, toType, attributes }`**. Changes a text block to another text block in place: paragraph to code block (run children are concatenated into `content`), code block to paragraph (content becomes one run with a fresh ID), and any block with empty runs to heading or thematic break. The block keeps its ID; removed child IDs are listed in the receipt so clients can drop them from pending state.

Indent is `WrapNodes` of the item into a new nested list under the previous sibling item, expressed as one server command so the previous-sibling lookup is not racy: **`IndentListItem { commandID, bodyEpoch, nodeID }`**.

## Why not extend `MoveNode`

`MoveNode` moves one existing node to an existing parent. Wrapping needs a parent that does not exist yet, and converting needs to drop children. Overloading `MoveNode` would weaken its single, simple invariant and its receipt shape. Separate commands keep each validator small.

## Cost and alternatives

- Every command starts a BodyEpoch, which pauses editing until it syncs. Typing `- ` would pause the editor for a round trip. Acceptable for deliberate conversions; noticeable for rapid list editing.
- Alternative: an identity-preserving representation of reparenting in the Yjs binding, so these edits are ordinary updates. [ADR 0014](0014-structural-moves-start-body-epoch.md) records that the current binding cannot do this. It is the better long-term fix and a larger one.
- Alternative: accept the limit and offer these conversions only from the block menu (issue #34), where a round trip is expected.

## Decision needed

Choose between the three commands above, the block-menu-only fallback, or a binding rewrite. Until then #30 stays partial.
