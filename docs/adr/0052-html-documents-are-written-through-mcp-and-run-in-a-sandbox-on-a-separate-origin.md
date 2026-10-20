---
status: proposed
date: 2026-10-20
---

# HTML documents are written through MCP and run in a sandbox on a separate origin

Dokudocs gets a document type `html`: a self-contained page that a person views, downloads and comments on. A User never creates one from the new-document menu. It comes from an outside MCP client acting for the User, so an AI-produced page can be kept, versioned and shared. The `html` type exists in `DocType`, in lists and in search, but is absent from the create dialog.

The main risk is that the page is code written by a model and run in other people's browsers. Isolation is decided before any feature.

**Where it runs.** A page is shown in `<iframe sandbox="allow-scripts">` without `allow-same-origin`, so it has an opaque origin and cannot read Dokudocs cookies, storage or the DOM. The iframe's address is on a **separate content origin** (`usercontent.<domain>`), never the application's. That origin gets its own TLS certificate and serves nothing else. The Dokudocs deployment provides the domain; until it exists the type is not switched on.

**What the page may load.** The content origin sends a Content-Security-Policy: scripts only from an allowlist of CDNs with pinned versions, stylesheets only from the fonts host, `connect-src 'none'`, `form-action 'none'`, `frame-src 'none'`, and `base-uri 'none'`. Images are `data:` only. A page's body is at most 1 MiB, including embedded images.

**Who writes it.** Only an MCP client, with `create_document` and `edit_document_content` (`replace_all`, `replace_text`, `append`, so the content permission applies, as for DBML and Mermaid), under the User's own edit rights ([ADR 0043](0043-agent-writes-follow-the-users-own-document-rights.md), [ADR 0045](0045-mcp-api-keys-belong-to-a-user-not-a-workspace.md)). An update names the version it read and is refused if the page changed; a named revision is made first, so one restore undoes it. The Agent in chat does not write `html`, and no one edits the source in the UI. People view, download the file, rename, move, trash, and comment on the page as a whole.

**How it is stored.** As the document's body text, one revision per write. There is no Yjs state: nobody types into the source, so there is nothing to merge, and the collaboration service is not involved. Offline editing of the source does not exist.

**What the page can ask for.** A page reaches Dokudocs only through a `postMessage` bridge, which checks the viewer's access to the document on every call. A capability the page did not declare is off.

- Version 1: **theme** (light or dark variables injected into the iframe) and **download** (a file the page builds, offered only from a user click).
- Version 2: viewer information (name and role only) and per-document state (a small, versioned blob).
- Last: `ask()`, read-only and through the viewer's AI permission ([ADR 0044](0044-ai-permissions-are-one-set-per-user-intersected-with-document-access.md)); it is not built before that ADR is checked for pages as callers.

**What the viewer sees.** The page runs on open, under a permanent banner saying it was made through MCP and by whom, so a misleading page is not mistaken for part of Dokudocs.

**Access.** The effective access rules apply unchanged ([ADR 0005](0005-document-access-policy.md)): a person who cannot read the document does not get the page, and the content origin's address carries a short-lived token, not a document id alone. Drafts, trash and revisions behave as for other documents.

**RAG.** The indexed text is the visible text extracted from the HTML without running it. Scripts and styles are dropped.

**Public link.** Not offered in version 1, even once the content origin exists. It opens through a later issue after the security tests below pass in staging.

## Security tests required before it is switched on

- Payloads that try to read the application's cookies or storage, navigate the top window, open popups, submit forms, load a script from a host outside the allowlist, or send data out through `fetch`, images, CSS `url()`, `<link>` and WebSocket.
- A page that posts forged bridge messages, and a page from one document asking for another document's state.
- A content-origin address used after the token expired, and after the viewer lost access.
- A very large body, deeply nested markup, and a `data:` image over the limit.
- The same set against the downloaded file opened from disk, which has no CSP.

## Amendments made while building it

- **Inline scripts are allowed**, `unsafe-eval` is not. A page that is one self-contained file needs its own `<script>`; what stops it from sending anything out is `connect-src 'none'`, `img-src data:`, `form-action 'none'`, `frame-src 'none'` and the script and style host lists, not a ban on inline script. The CDN allowlist is by host: a policy cannot require a pinned version.
- **A page can still send its own frame to another address.** No policy prevents that, so version 1 gives a page no data of the viewer's or the workspace's. The viewer-information and state capabilities (version 2) need this limit in mind, and the checks in `docs/html-pages-security.md` pass before either is built.
- **The content origin must not equal the application's.** The API treats such a configuration as the feature being off.

## Considered options

- **Users write HTML in an editor.** The most useful, and the most dangerous: anyone with edit rights could ship hostile markup to every viewer. Left out; the MCP path has a named User and key behind each write.
- **Same origin, `<iframe sandbox>` only.** Cheaper, but a bug in the sandbox attribute or a forgotten `allow-same-origin` would expose the application. Rejected.
- **Yjs text like DBML and Mermaid ([ADR 0033](0033-dbml-and-mermaid-use-collaborative-source-text.md)).** Gives offline edits and merging nobody needs here, and puts pages in the collaboration service's memory.
- **Click to run on first view.** Safer against misleading pages, but adds a step to every document. A permanent banner was chosen instead.
- **All five capabilities in version 1.** Each is one more surface that must check access on every call; they come in order of risk.

## Consequences

- Backend: a migration adds `html` to the `document_type` enum (like `20261008000001_add_architecture_document_type`), validation of size and type, and MCP tools accepting the type. Frontend: `DocType`, a viewer with the banner and bridge, and a download action.
- Deployment: a content domain, its certificate, and the CSP headers on that origin only.
- The Agent in chat can read `html` documents but not write them; MCP clients write them. If this should change, it needs a new decision.
