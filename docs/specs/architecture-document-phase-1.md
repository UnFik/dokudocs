# Architecture documents: phase 1 technical specification

Status: ready for implementation, 2026-10-07. Product behaviour is in [the plan](../plans/architecture-document.md) and [the catalog](../plans/architecture-catalog.md); storage is [ADR 0031](../adr/0031-architecture-canvas-is-yjs-state.md). This document says what phase 1 builds, where, and how it is tested. Terms follow `GLOSSARY.md`.

## 1. Scope

Phase 1 delivers a working, collaborative canvas:

- `architecture` as a document type: create, open, rename, trash, duplicate, revisions and restore.
- The catalog: table, seed, read endpoint, icons.
- The canvas: palette with search, Hosts, Systems, Groups, Connections with protocol, properties panel, grid slot on first entry into a Host, "Take out", resize, fit to contents, delete with notices, collapsible side panels, presence, undo, element limits.
- JSON export.
- Catalog requests are stored (form and table); the admin list and notifications come later.

Not in phase 1 (later phases of the plan): Document links and their table, "Used in", Architecture versions, the text summary in RAG, PNG/SVG export, public link view, comments on elements. The canvas already stores `links` arrays, empty in phase 1, so phase 2 adds no schema change to the Yjs state.

## 2. Spike results

Branch `spike/architecture-collab-room`, commit `10c1a04`. The spike answered the three questions the plan left open.

**Q1. How `collab/` tells room kinds apart.** The Go API returns the document type from `authorize`; the service keeps `markdown` as the default when the field is absent, so the change can ship before the API's. The type lives in the connection context and in a per-room map (the store hook has no connection). Rejected alternative: a room-name prefix (`arch:{ws}.{doc}`), which a client could forge and which the API would have to check anyway. Code: `collab/src/server.ts`, `collab/src/architecture.ts`.

**Q2. Deterministic rebuild.** `seedArchitecture(json)` builds the state with a fixed client id (`0x5eed`, as `seedFromJSON`), elements sorted by id and fields in a fixed order. Tests prove: same bytes for the same JSON in any order, two rebuilt copies merging without doubling, and edits to different fields of one element both surviving.

**Q3. Limit check on the server.** Yes, in `beforeHandleMessage`, only for editors (everyone else is on a read-only connection, which drops updates without closing). The full check (apply the update to a copy, count elements) costs 13 ms on a full canvas, too much for every drag frame. A fast path decodes the update and runs the full check only when it writes a key of the top-level `nodes` or `connections` map: 0.02 ms for a move or rename. Only growth past a limit is refused, so an over-limit document can still shrink.

Measured on a full canvas (500 Systems, 1000 Connections, 200 edits of history), `COLLAB_LOAD=1 npx vitest run test/architecture-load.test.ts`:

| Measure | Result |
|---|---|
| Stored state | 271.5 KB |
| Check of an update that moves or renames | 0.02 ms |
| Check of an update that adds an element | 13.3 ms |
| Deriving JSON and text summary on store | 1.2 ms |

**Found while reading the code** (each is a task below):

- `room_head.go` gives nobody access to a room of a non-Markdown document.
- `get_by_id_query.go` returns `content_json` only for Markdown.
- `create_document_usecase.go` accepts `content_json` only for Markdown.
- `restore_revision_query.go` restores only Markdown.
- `update_query.go` protects `content` from metadata writes only for Markdown.
- `rag_index.go` indexes only Markdown (correct for phase 1).
- A refused update closes the connection; the provider reconnects and sends it again, forever. A normal editor never sends one (it stops at the limit), but the client must stop on a refusal instead of looping.
- `frontend/src/features/docs/lib/collab-session.ts` is not Markdown-specific and is reused as is.

## 3. Database

Migrations follow the existing naming (`YYYYMMDDNNNNNN_name.up.sql` / `.down.sql`).

**3.1 Document type.**

```sql
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'architecture';
```

PostgreSQL does not allow the new value to be used in the same transaction, so this migration contains nothing else. The down migration cannot remove an enum value; it fails if any `architecture` document exists and otherwise recreates the type without it (same pattern as any enum shrink: new type, `ALTER COLUMN ... TYPE ... USING`, drop old). Update `dbml-dokudocs.dbml` and the comment in `backend/internal/domain/model/document.go`.

**3.2 Catalog.**

```sql
CREATE TYPE catalog_category AS ENUM ('host', 'system', 'protocol');

CREATE TABLE catalog_entries (
    slug        TEXT PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    category    catalog_category NOT NULL,
    subkind     TEXT NOT NULL,
    name        TEXT NOT NULL,
    family      TEXT CHECK ((category = 'protocol') = (family IS NOT NULL)),
    sort_order  INT NOT NULL DEFAULT 0,
    deprecated  BOOLEAN NOT NULL DEFAULT FALSE
);
```

For protocols, `subkind` holds the family as well, so the palette and the hints read one column. The seed is a separate migration generated from `docs/plans/architecture-catalog.md` by `scripts/catalog-seed` (it parses the tables, as the spike's generator did) and committed as SQL with `ON CONFLICT (slug) DO UPDATE SET name, subkind, family, sort_order, deprecated`. A later catalog change is a new generated migration; a slug is never deleted.

**3.3 Catalog requests.** Stored in phase 1 so nothing typed into the form is lost; the admin list and notifications come later.

```sql
CREATE TABLE catalog_requests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    name_key      TEXT NOT NULL UNIQUE,
    category      catalog_category NOT NULL,
    website       TEXT,
    note          TEXT CHECK (length(note) <= 1000),
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'added', 'declined')),
    resolved_slug TEXT REFERENCES catalog_entries(slug),
    decline_reason TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE catalog_request_votes (
    request_id   UUID NOT NULL REFERENCES catalog_requests(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (request_id, user_id)
);
```

`name_key` is the name lowercased with everything but letters and digits removed.

**3.4 No other table changes.** The Yjs state uses `document_collab_states` as it is; `documents.content_json` holds the canvas JSON and `documents.content` the text summary.

## 4. Go API

**4.1 Collaboration internals.**

| File | Change |
|---|---|
| `application/collaboration/room.go` | `RoomHead` gains `DocumentType string`. |
| `infrastructure/repository/document/room_head.go` | Allow `markdown` and `architecture`; fill `DocumentType`. DBML and Mermaid keep no room. |
| `presentation/collab/handler/internal_handler.go` | `authorize` returns `"documentType"`. `storeState` unchanged: for a canvas `markdown` carries the summary and `suggestions` is empty. |

**4.2 Documents.**

| File | Change |
|---|---|
| `application/document/usecase/create_document_usecase.go` | For `architecture`, `content_json` defaults to `{"version":1,"nodes":[],"connections":[]}`; a given one must be an object with `version` 1 and array `nodes` and `connections`, else `ErrInvalidContentJSON`. `content` starts empty. |
| `infrastructure/repository/document/get_by_id_query.go` | Return `content_json` for `architecture` as for Markdown. |
| `infrastructure/repository/document/update_query.go` | Treat `content` of `architecture` like Markdown: derived, never written by a metadata update. |
| `infrastructure/repository/document/restore_revision_query.go` | Allow `architecture`. Skip the comment-anchor reset (a canvas has no anchors). Then drop the state and reload the room, as for Markdown. |
| `infrastructure/repository/document/duplicate_query.go` | No change expected (it copies content and JSON without a state; covered by an existing test). Add an architecture case to that test. |
| Validation of `type` on create | Accept `architecture` wherever `markdown`, `dbdiagram`, `mermaid` are listed (request DTO, Swagger). |

**4.3 Catalog endpoints.** New `catalog` feature package in the existing layers (handler, usecase, repository).

| Endpoint | Who | Answer |
|---|---|---|
| `GET /api/v1/catalog` | any signed-in user | `200` with `{ "entries": [{ slug, category, subkind, name, family, sortOrder, deprecated }] }`, deprecated entries included (canvases still show them). `ETag` from a hash of the rows; `Cache-Control: private, max-age=3600`; `304` on a matching `If-None-Match`. |
| `POST /api/v1/catalog/requests` | any signed-in member of the workspace in the body | Body `{ workspaceID, name, category, website?, note? }`. Same `name_key` adds a vote (idempotent per user). `201` with `{ id, name, votes, alreadyRequested }`. `409` when the name matches an existing entry name or slug (the answer carries the slug, so the client can offer it). `429` past 20 open requests by that user. |

## 5. Collaboration service (`collab/`)

Keep the spike's code and finish it:

1. `authorize` type: drop the `| string` widening once the API ships the field; keep the `markdown` default for a rolling deploy.
2. On a refused update (`too-many-elements`), send a stateless `{"type":"refused","reason":"too-many-elements"}` to that connection before throwing, so the client can stop (§6.8).
3. Metrics: count refusals by reason (`metrics.refuse` already exists for connection refusals; add an update-refusal counter).
4. Tests already in the spike: `architecture.test.ts` (seed, JSON, merge, bad input, summary, links, fast path), `architecture-room.test.ts` (two editors, store, seed from JSON, commenter read-only, limit, DBML/Mermaid refused), `architecture-load.test.ts` (measurements, `COLLAB_LOAD=1`). Add one for the `refused` message.

`linkedDocuments()` stays unused until phase 2.

## 6. Frontend

New feature folder `frontend/src/features/architecture/`. Dependency: `@xyflow/react` (MIT), pinned exactly like the rest of `package.json`.

**6.1 Opening a document.** `doc-editor.tsx` renders `ArchitectureEditor` for `type === 'architecture'`. It opens the room with `openCollabSession` (same provider, local copy and presence as Markdown) and shows the canvas read-only from `content_json` until the room has synced, as the Markdown editor does.

**6.2 State binding.** `useArchitectureDoc(ydoc)` exposes nodes and connections as React Flow `nodes`/`edges` and writes changes back:

- One `Y.Map` per element under `nodes` / `connections`, fields as in ADR 0031 / `collab/src/architecture.ts` (shared type definitions move to a file both packages import, the way `collab/src/schema.ts` imports the editor schema).
- Positions in Yjs are relative to the parent, as React Flow uses them; parents are sorted before children when building React Flow nodes.
- During a drag, position writes are throttled to one per 50 ms, plus a final write on drop. One gesture is one undo step: `Y.UndoManager` with `trackedOrigins` set to the local origin, `stopCapturing()` at the start and end of a gesture.
- New ids: `nanoid()` on the device.

**6.3 Components.**

| Component | Does |
|---|---|
| `ArchitectureEditor` | Layout (palette, canvas, properties) and toolbar: title, presence, Export. "Tag version" arrives with versions in phase 3. |
| `CatalogPalette` | Search over name and slug, sections by category and subkind (collapsible, open state remembered per user), Group item, empty state (§6.6). Data from `GET /catalog` via TanStack Query, cached. |
| `HostNode`, `GroupNode`, `SystemNode` | Custom React Flow nodes. Host and Group have a label bar (drag handle) and resize handles when selected (`NodeResizer`). System has a source handle on the right and a document badge (hidden in phase 1). |
| `ConnectionEdge` | Bezier edge, label `protocol · label`, line style by family: request solid, stream 2.5 px, message dashed, data dotted, telemetry thin dashed muted. |
| `ProtocolPopover` | Opens after a connection is drawn: suggested protocols for the target's subkind (table in the catalog doc), others in a grouped select. |
| `PropertiesPanel` | Name, catalog entry (picker, so a generic Service can become the right entry later), tags, description, repo URL; for Host/Group: size, "Fit to contents", "Take out", delete with confirmation. Document links section is absent in phase 1. |
| `TakeOutButton` | Floating button over the selected element inside a container (§6.5). |
| `CatalogIcon` | One icon by slug and the resolved theme (§7). |

**6.4 Constants** (one module, used by canvas and tests): cell 132 × 50, gap 16, padding 14, label band 32, empty container minimum 160 × 90, new Host 200 × 130, new Group 220 × 140, limits 500 nodes and 1000 connections, warning at 80%, palette 200 px, properties 260 px, collapsed rail 40 px.

**6.5 Container behaviour** (plan: "Putting something into a Host", "Inside a Host", "Taking something out", "Fit to contents", "Manual resize"):

- First entry into a container (from the palette or from the top level): placeholder in the nearest free cell (`slotFor`), container grows while it shows; drop places the element there and sets `parentId`. A Host or Group entering goes in the band below the contents (`bandFor`).
- Inside a container: React Flow `extent: 'parent'` is not used (it would stop at the right and bottom too). Instead the drag is clamped at left padding and label band, and the container (and its parents) grows on the right and bottom (`growToFit`). Dropping over another container changes nothing.
- "Take out": moves the element one level up, into the parent's next free cell or band, or at the top level to the first free spot right of the old container with no overlap. One undo step. Keyboard reachable.
- Resize: never below the contents' box; empty stops at 160 × 90; parents grow. Arrow keys 8 px, Shift 32 px on a focused handle.
- "Fit to contents": tight box around direct children; disabled with a reason when empty or already tight.
- The geometry functions (`slotFor`, `bandFor`, `growToFit`, `tightBox`, `freeSpotBeside`) are pure and live in `features/architecture/lib/layout.ts`, ported from the mock.

**6.6 Palette empty state.** No match shows: "No “{query}” in the catalog.", a short explanation, a draggable item "Drag “{query}” as a Service" (catalog `service`, name = query), and "Request “{query}”" opening the form (name, kind, website, what it is for). Sent: confirmation line; a `409` offers the matching entry instead. Copy goes through `antislop-copywriting` when written.

**6.7 Delete.** A System or Connection deletes at once with a notice naming what was removed and how many linked documents stay (always 0 in phase 1, so the clause is omitted); a Host or Group with contents asks first, naming the count. Never touches documents.

**6.8 Limits and refusals.** The palette shows a warning at 400 nodes / 800 connections and disables adding at the limit with the reason. On a `refused` stateless message the session stops sending (provider disconnected, local copy kept), and the editor shows "This canvas has reached its limit; remove elements to keep editing." with a reload action. Read-only state follows the `access` message (`canEdit`).

**6.9 Side panels.** Collapse buttons in each panel header; collapsed width 40 px with a vertical label; choice saved to `user_settings.editor_prefs` as `architecture_palette_open` and `architecture_props_open` through the existing settings endpoint.

**6.10 Other screens.**

| Place | Change |
|---|---|
| `create-doc-dialog.tsx` | "Architecture" type; creates with the empty canvas JSON. |
| `doc-type-badge.tsx` | Tag `architecture`. |
| `doc-thumbnail-preview.tsx` | Small static drawing of the hosts and systems from `content_json` (boxes only, no icons). |
| `project-docs-hover-card.tsx` | Type label. |
| `import-doc-dialog.tsx` | No architecture import in phase 1. |
| Revision history | Preview renders the canvas read-only from the revision's `content_json`; restore uses the existing flow. |
| `public-markdown-document.tsx` | Phase 1: an Architecture document shared by public link shows "This document type cannot be viewed by public link yet." |
| Export | "Export JSON" downloads `content_json` as `<title>.architecture.json`. |

## 7. Icons

`scripts/catalog-icons` (Node), run by hand when entries change; output committed:

- Input: `scripts/catalog-icons/catalog-icons.json` (`slug → { source, name, variant?, dark?, light? }`), generated once from the catalog and reviewed; `scripts/catalog-icons/manual/` for press-kit logos.
- Sources in phase 1: Google Cloud icon zip, Devicon 2.17.0 `original`, Simple Icons 16.34.0 with brand colour, Lucide 1.52.0 (generic entries and fallbacks). AWS and Azure entries use Lucide `cloud` until their terms are cleared (catalog doc, Terms).
- Steps: SVGO (keep viewBox, prefix ids with the slug), pixel test per theme (render 64 px with resvg; more than 50% of opaque pixels under 1.5:1 contrast marks it faint), variant per the catalog doc's order, write `frontend/src/assets/catalog/<slug>.svg`, optional `.dark.svg` / `.light.svg`, `manifest.json`, `ICON-SOURCES.md`.
- `CatalogIcon` loads the file with `import.meta.glob` (lazy), picks the variant from the manifest and the theme provider, and renders Lucide icons inline with `currentColor`.
- Test: every non-deprecated slug has an icon or a Lucide mapping; every icon flagged faint has a variant or tile.

## 8. Tests

Following `docs/specs/dokudocs-testing-spec.md`:

| Layer | Cases |
|---|---|
| Collab (Vitest) | Spike tests plus the `refused` message. |
| Go handler | `authorize` includes `documentType`; catalog `GET` with and without `If-None-Match`; request `POST` validation, `409`, `429`. |
| Go usecase | Create architecture with default and with given JSON; invalid JSON refused. |
| Go integration (PostgreSQL) | Enum migration up/down; catalog seed idempotent; `room_head` access for architecture and none for DBML/Mermaid; `get_by_id` returns JSON; `update` keeps derived `content`; restore of an architecture revision; duplicate; request vote idempotence and `name_key` merge. |
| Frontend pure | `layout.ts` (slot nearest free cell, new row only when full, band, clamp and grow, take-out spot never overlapping, tight box, minimum size); Yjs binding round-trip; protocol hints by subkind; palette search and empty state; icon variant choice. |
| Frontend browser | Drag from palette into a Host lands in the slot; drag inside cannot leave; Take out; resize stops at contents; fit; delete notice and Host confirmation; collapse remembered; read-only for a commenter; limit warning and disabled add. |
| E2E | Live smoke: create Architecture document → add a Host and a System inside it → connect two Systems → reload → canvas is the same; second browser sees the change live. |

## 9. Delivery order

Each slice is a pull request that leaves `main` working.

1. **Type and room**: enum migration, Go type plumbing (§4.1, §4.2), collab from the spike (§5). Architecture documents can be created by API and opened by a test client.
2. **Catalog**: tables, generated seed, `GET /catalog`, `POST /catalog/requests`, icon script and assets (§3.2, §3.3, §4.3, §7).
3. **Canvas core**: editor shell, binding, palette, nodes, connections and protocol popover, properties, delete, create dialog, badge (§6.1–6.4, 6.6, 6.7, 6.10 first rows).
4. **Containers and polish**: slot, clamp and grow, take out, resize, fit, side panels, limits and refusal, undo grouping, presence (§6.5, 6.8, 6.9).
5. **History and export**: revision preview and restore, JSON export, thumbnail, public-link notice (§6.10 rest).

## 10. Decisions still open

- Legal clearance of AWS and Azure icons (until then: Lucide `cloud`).
- Who reviews catalog requests and how they are notified (needed before the admin list, not for phase 1).
- Shared type module location between `collab/` and `frontend/` (a file under `frontend/src/features/architecture/lib/` imported by `collab/`, as `schema.ts` does today, is the default).
