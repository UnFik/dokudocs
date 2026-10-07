# Plan: Architecture documents

Status: agreed in a design session on 2026-10-07; nothing is built. Terms follow `GLOSSARY.md` (section Architecture). The storage decision is [ADR 0031](../adr/0031-architecture-canvas-is-yjs-state.md).

## Why

A project's documentation is scattered: a DBML file for the database, Markdown pages for the backend, a Mermaid flow for a checkout. Nothing shows how the pieces fit or where to find the page for one of them. An Architecture document draws the system (where each part runs, what talks to what, over which protocol) and every part points at the documents that describe it. It becomes the entry point to a project's documentation, and several people edit it together like any other document.

## What a person can do

- Create an Architecture document in a project, next to Markdown, DBML and Mermaid documents. A project may hold several (Prod, Staging, a target design).
- Drag Hosts, Systems and Groups from the palette onto the canvas. Drop a System into a Host to say it runs there; drop a Host into a Host (cluster → node).
- Draw a Connection by dragging from one System's handle to another, then pick its protocol.
- Select a System or Connection to edit its properties and its Document links in the right panel.
- Open a linked document from the panel, or create a new document that is linked straight away.
- From a linked document, see where it is used ("Used in Prod › Backend Order") and jump to that node.
- Edit together: live changes, cursors and selections of others, offline edits, revisions and restore.
- Tag an Architecture version ("v2.0 – split the monolith"), which also freezes every linked document as it is now; open any version read-only, with its documents as they were, or restore the canvas to it.
- Export the canvas as PNG, SVG or JSON. Share by public link as a read-only canvas.

## Model

### Elements on the canvas

| Element | Holds | Rules |
|---|---|---|
| **Host** | name, catalog entry (category `host`), optional parent Host | May sit inside a Host. Cannot be a Connection endpoint. No Document links. |
| **System** | name, primary catalog entry (category `system`), tags (catalog entries), description (plain text), repo URL (optional), optional parent Host, Document links | Never contains a System. Stands alone when external (SaaS). |
| **Group** | label, optional parent | Visual only. May hold Hosts and Systems. |
| **Connection** | source System, target System, protocol (catalog entry, category `protocol`), label, port (optional), Document links | Always directed, caller → callee. Several per pair allowed. |

A broker is a System (subkind `broker`). Direction stays caller → callee, so both the producer and the consumer point **at** the broker: the producer with protocol `publish`, the consumer with `subscribe`.

Deleting a Host deletes everything inside it and their Connections, after a confirmation that names the count ("Delete VPS-1 and the 3 Systems in it?"). Undo brings them back. Where a System runs changes only by putting it into a Host or taking it out with "Take out" (below).

**Deleting never cascades to documents.** Deleting a System, a Connection or a Host removes only the elements and their Document links. Every linked document stays in its project, untouched, with its own history. The confirmation and the notice after a delete say so ("4 linked documents stay in the project"). The same holds for deleting the whole Architecture document.

**Putting something into a Host: a slot on a grid.** When a System is dragged into a Host or Group for the first time (from the palette, or from the top level of the canvas), the container shows a dashed placeholder in the free grid cell nearest the pointer, and the System lands in that cell on drop. Cells are a constant 132 × 50 with 16 px between them, 14 px padding and 32 px for the label on top; the number of columns follows the container's current width. Free cells inside the current box are used before a new row, and when a new row is needed the container grows while the placeholder is shown, so the person sees the final size before dropping. A Host or Group dragged into a Host goes in the band below everything already there, left-aligned. The grid only places the element; it is stored as an ordinary position and moves freely afterwards.

**Inside a Host, dragging never takes an element out.** A System (or nested Host or Group) dragged inside its container stays inside it: it stops at the left and top padding, and the container grows toward the right and bottom as the element is pushed there (and its parents in turn). Dropping it over another container does nothing to its parent. The container never shrinks on its own; "Fit to contents" and manual resize do that.

**Taking something out: the "Take out" button.** A selected element that sits inside a Host or Group shows a floating button above its top-right corner, with an "exit box" icon and the label "Take out" (tooltip "Take out of VPS-1"). It moves the element one level up: into the parent container's next free grid cell (or its bottom band for a Host), or, at the top level, to the first free spot to the right of the old container, never overlapping another element. Connections and Document links stay. For a System this changes where it runs, and the notice after the move says so. It is one undo step and reachable with the keyboard (Tab to the button, Enter).


**Fit to contents.** When a Host or Group is selected, the properties panel offers "Fit to contents". It sets the container to the smallest box that holds every element directly inside it, with the same padding as auto-grow (room for the label on top). It may shrink or grow the container and moves its top-left corner if needed; the elements inside do not move. Parents then grow if they have to, as with any drop. Nested Hosts keep their own size. The action is disabled with a short reason when the container is empty or already fits, and it is one undo step.

**Manual resize.** A selected Host or Group shows resize handles on its four corners and four edges (React Flow's `NodeResizer`). It cannot be made smaller than the box its contents need, so a resize never cuts through an element inside it; an empty one stops at 160 × 90. Resizing does not move or reparent the elements inside, and parents grow if the container outgrows them. With the keyboard, a focused handle moves 8 px per arrow press, 32 px with Shift. The new size is shown in the properties panel while dragging, and one resize is one undo step.

Environment and version are not properties: Prod and Staging are separate Architecture documents.

### Catalog

One global table, seeded by migration, read-only to people. No per-workspace entries.

```
catalog_entries
  slug        text pk          -- golang, react, nginx, postgresql, kafka, vps, k8s, rest, grpc
  category    enum             -- host | system | protocol
  subkind     text             -- palette section and protocol hints; lists in the catalog file
  name        text             -- "Go", "PostgreSQL", "gRPC"
  family      text null        -- protocol only: request | stream | message | data | telemetry
  sort_order  int
  deprecated  bool default false
```

- The canvas stores the **slug**, never a numeric ID, so the derived JSON is readable and survives a reseed.
- Icons are full-colour logos and official cloud service icons, bundled in the frontend as SVG files keyed by slug; never loaded from another site. An unknown or deprecated slug renders the subkind's generic icon and the stored name; nothing breaks. Sources, colour rules and the build script are in [architecture-catalog.md](architecture-catalog.md#icons). People cannot upload their own icon for a node.
- `GET /api/v1/catalog` returns the list; it changes only with a deploy, so it is cached hard.
- Pairing hints: the protocol popover lists the protocols that fit the target first (`db-connection` when the target is a database, `publish`/`subscribe` for a broker). Nothing is refused.

The full list of entries, the subkinds, the protocol families and the suggestions per target are in [architecture-catalog.md](architecture-catalog.md). In short:

- Host subkinds: `compute`, `orchestration`, `network`, `aws`, `gcp`, `azure`, `paas`, `client`.
- System subkinds: `language`, `frontend`, `backend`, `mobile`, `database`, `cache`, `search`, `broker`, `gateway`, `storage`, `auth`, `observability`, `ai`, `job`, `external`.
- Protocol families: `request`, `stream`, `message`, `data`, `telemetry`.
- A managed service is a Host (AWS RDS) and the engine in it is a System (PostgreSQL). Tags on a System are catalog entries too; libraries and versions go in its description.

### Yjs state (record of the document)

Same `collab/` service and rooms as Markdown (ADR 0031). The Y.Doc of an Architecture document has two top-level maps; each element is its own `Y.Map`, so two people changing different fields of one node both win.

```
nodes:        Y.Map<id, Y.Map>
  kind        "host" | "system" | "group"
  parentId    string | null
  x, y        number           -- position relative to the parent, as React Flow uses it
  w, h        number | null    -- hosts and groups only
  name        string
  catalog     string | null    -- slug
  tags        Y.Array<string>  -- slugs, systems only
  description string
  repoUrl     string | null
  links       Y.Array<documentId>

connections:  Y.Map<id, Y.Map>
  source, target   node id (systems only)
  protocol         slug
  label            string
  port             string | null
  links            Y.Array<documentId>
```

IDs are random (nanoid), created on the device. React Flow needs parents before children; the editor sorts when it maps the Y.Doc to React Flow nodes. Undo is a local `Y.UndoManager`, so a person only undoes their own changes.

### What is derived on every store

The API receives the state from `collab/` (`PUT /internal/collab/document`) and, in the same transaction, writes:

1. `documents.content_json`: `{ "version": 1, "nodes": [...], "connections": [...] }`, plain JSON from the maps above. Revisions snapshot it; JSON export is this file.
2. `documents.content`: a short text summary for search and RAG, one line per element, e.g. `System "Backend Order" (Go; Gin) runs on Host "VPS-1". Calls "PostgreSQL" over DB connection. Publishes to "Kafka".` Search and RAG need no change.
3. `architecture_document_links` (derived, rebuilt from `content_json` at will):

```
architecture_document_links
  architecture_id  uuid fk documents   -- the Architecture document
  element_id       text                -- node or connection id
  element_kind     enum                -- system | connection
  document_id      uuid fk documents   -- the linked document
  pk (architecture_id, element_id, document_id)
```

The projection drops links to documents outside the workspace and to non-Markdown/DBML/Mermaid documents, so a crafted update cannot make a link that shows up anywhere.

Restore follows ADR 0029: write `content_json`, drop the state, reload the room; the state is rebuilt from the JSON the same way every time.

### Architecture versions

An Architecture version is a named revision of the canvas plus a pin to a named revision of each linked document ([ADR 0032](../adr/0032-architecture-version-pins-named-revisions.md)).

Creating one ("Tag version" in the document's revision history):

1. A named revision of the Architecture document is written from the current `content_json`, titled with the label.
2. For every document in `architecture_document_links` that the person tagging can read, the system writes a named revision of that document, titled "<architecture title> <label>" (e.g. "Prod v2.0"), authored by that person. Named revisions are never combined, so the pin cannot vanish. This happens even when the person cannot edit the document; it changes nothing in the document's body.
3. Documents the person cannot read are recorded as not pinned.

All in one transaction; a document linked twice gets one revision.

```
architecture_versions
  id               uuid pk
  architecture_id  uuid fk documents
  revision_id      uuid fk document_revisions   -- the canvas snapshot
  label            text                         -- free text; placeholder suggests "v1.0.0"
  description      text null
  created_by       uuid fk users
  created_at       timestamptz
  unique (architecture_id, label)

architecture_version_pins
  version_id       uuid fk architecture_versions
  document_id      uuid fk documents
  revision_id      uuid null fk document_revisions   -- null: not pinned (no read access at tag time)
  pk (version_id, document_id)
```

Rules:

- Who: `edit` on the Architecture document creates a version and edits its label and description. Only an owner deletes one; deleting a version leaves the named revisions it made (they are ordinary history).
- The content of a version never changes. The label is free text and unique within the document.
- Opening a version shows the canvas read-only; a linked document opens at its pinned revision, still subject to the viewer's access today. A not-pinned link opens the current document with a note that it was not frozen.
- "Restore to this version" restores the canvas only (the normal restore path); linked documents are untouched, each has its own history.
- A linked document's history shows the revisions made for versions with the version's name, so its readers see it was part of "Prod v2.0".

## Access

- Same as every document: EffectiveDocumentAccess on the Architecture document decides who sees and edits the canvas. `edit` → editable room. `comment` and `view` → read-only room; there is no suggest mode on a canvas.
- Linking a document needs edit on the Architecture document and read on the target document, in the same workspace.
- A linked document the viewer cannot read shows as a locked card with no title. Counts on node badges include it (the canvas is shared; the title is what is hidden).
- "Used in" on a document page lists only the Architecture documents the viewer can read.
- Public link: read-only canvas; linked documents follow their own visibility (locked unless they are public too).

## Screen

- Route: the normal document route; the page picks the canvas editor by `type = architecture`.
- **Left: palette.** Search box, then sections Host and System (both grouped by subkind, collapsible) and Group. A search with no result says the entry is not in the catalog and offers to place a generic Service with the typed name and to request the entry ([catalog, Requesting an entry](architecture-catalog.md#requesting-an-entry)). Items drag onto the canvas. Connections are not in the palette; a legend of the five protocol families and their line styles sits at the bottom.
- **Centre: canvas** (`@xyflow/react`, MIT). Nodes show the catalog icon, name, tags and a document badge (📄 3). Connections show the protocol label; line style per protocol family (request, stream, message, data, telemetry).
- After a connection is drawn, a popover asks for the protocol, preselected to the best fit (REST by default).
- **Right: properties panel** for the selection: fields from the model, then Document links (list with type icon, read-only preview of the selected one, "Open", "Link existing…", "New document…"). "New document…" creates it in the same project and links it in one step. For a Host or Group the panel also shows its size and the "Fit to contents" action.
- **Collapsing the side panels.** The palette and the properties panel each have a collapse button in their header (a panel icon with a chevron). Collapsed, a panel shrinks to a 40 px rail holding the expand button and its name written vertically, and the canvas takes the space. Selecting an element does not reopen a collapsed properties panel; the rail stays where it is. Each person's choice is remembered across documents and devices in `user_settings.editor_prefs` (`architecture_palette_open`, `architecture_props_open`). On narrow screens the panels stack above and below the canvas and collapse to their header row.
- Presence: other people's cursors in canvas coordinates and a coloured outline on what they have selected, from awareness, name and colour only (ADR 0020).
- Limits: 500 nodes and 1,000 connections per document. The palette warns at 80% and stops adding at the limit.
- UI copy and visuals follow `DESIGN.md` and the antislop skills when built.

## Phases

1. **Canvas.** `architecture` in `document_type` (migration + Go model comment + create menu); catalog table, seed, endpoint, icons; `collab/` loads and stores architecture rooms (state ↔ `content_json`); canvas with palette, nesting, connections, properties, undo, presence; revisions and restore; JSON export.
2. **Document links.** Links in the panel, create-and-link, `architecture_document_links` projection, locked cards, "Used in" section on document pages with jump-to-node.
3. **Versions and reach.** Architecture versions (tag, pins, open read-only, restore canvas, label edit, owner delete); text summary for search and RAG; PNG and SVG export; public link view; limit warnings; visual diff between two versions (added, removed and changed elements coloured).
4. **Later.** CommentThreads anchored to a node or Connection (needs an anchor type besides text ranges).

## Out of scope

Suggest mode on canvases; per-workspace catalog entries; refusing odd protocol pairings; technology versions on a System (Go 1.22) and the running release of a System (v3.4.1); environment properties; editing a linked document inside the canvas; links from Hosts.

## Implementation

Settled by the spike on `spike/architecture-collab-room` and specified in [the phase 1 technical specification](../specs/architecture-document-phase-1.md): how `collab/` tells room kinds apart (the API's `authorize` returns the document type), the deterministic rebuild (`seedArchitecture`), and the element limit (checked in the service, with a fast path for updates that cannot add an element).
