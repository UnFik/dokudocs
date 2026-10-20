---
status: proposed
date: 2026-10-20
---

# A structured `diagram` document type waits for real demand

Dokudocs will not add a `diagram` document type yet. Mermaid 11.17 already draws swimlane, radar, venn, treemap, fishbone and Wardley diagrams (spike in `docs/plans/diagram-types.md`, enabled in the editor by #180), and an uploaded SVG covers "I already have the picture" (#182). What no installed renderer draws is **pyramid/funnel, waterfall, heatmap and org chart**. Four chart kinds with no user asking for them do not justify a new document type, which costs an enum migration, the `DocType` union, access and lifecycle rules, revisions, RAG text, comment anchors and Agent behaviour.

**What opens this decision.** Three separate requests for one chart kind, or one customer naming it as a requirement. Until then Mermaid (`xychart-beta` for simple waterfalls, `treemap-beta`, `quadrantChart`), a Markdown table, or an uploaded image answers the need.

**The direction to take when it opens.** This is recorded so the work does not start from nothing; none of it is decided.

- **Body.** A JSON envelope `{ kind, schemaVersion, data }`. Free-form HTML or SVG is not the body: it cannot be validated, indexed or edited by the Agent. The `html` type ([ADR 0052](0052-html-documents-are-written-through-mcp-and-run-in-a-sandbox-on-a-separate-origin.md)) is a separate thing and is not a way to draw diagrams.
- **Collaboration.** Source text in Yjs, as for DBML and Mermaid ([ADR 0033](0033-dbml-and-mermaid-use-collaborative-source-text.md)), so a half-typed document still saves. A structured `Y.Map` handles conflicts better but costs far more and is not worth it for four chart kinds.
- **First kind.** Waterfall, as the proof; others follow one by one, each with evidence.
- **Renderer.** One renderer per `kind` behind a registry: `schema`, `render(data, theme) → SVG`, `summarize(data) → text` for RAG, `anchors(data) → ids` for comments. The `schema` lives in one place shared by the backend check and the editor, so bad input is refused with a clear message.
- **Style.** The same tokens as the Mermaid theme (`lib/mermaid-theme.ts`), with `--signal` as the only accent.
- **Agent.** Edits through approved operations on the data, as for Architecture ([ADR 0049](0049-the-agent-edits-architecture-documents-with-approved-operations.md)), not by replacing the body.

## Considered options

- **Build it now with the four kinds.** Cheapest to say, most expensive to carry; the first kind alone would be the proof the work needs, and no one has asked for it.
- **Let `html` documents draw these diagrams.** It would work, but the result could not be commented on per element, indexed for RAG, or edited by the Agent. Rejected as the main path; the two types stay separate.
- **Add the kinds as Mermaid-like text.** Mermaid has no plug-in point for new diagram types in the installed version.

## Consequences

- #178 is closed by this record. A later issue reopens it when the trigger is met, starting from the direction above.
- Nothing changes in the database, API or editor.
