---
status: proposed
date: 2026-11-03
---

# PDF export prints a page the browser builds, on an isolated converter

A Markdown document exports as `.md`, `.pdf` or `.docx` from one dialog. The PDF is real
(paginated, with selectable text) and downloads in one step. Word and Markdown are built
in the browser; the PDF needs a browser engine, so it is printed on the server.

**Where the page comes from.** The browser renders the document's Markdown with the same
renderer as the public page, draws Mermaid in the light theme, opens toggles, writes images
and the formula fonts into the page as `data:` addresses, and sends `{title, html}` to
`POST /documents/{id}/export/pdf`. The API checks that the caller can read the document and
that it is Markdown, then wraps the HTML in its own shell and prints it. The document id only
gates access: the API cannot tell whether the HTML matches the document, so the rest of this
decision is about making any HTML harmless.

**Where it is printed.** A Chromium-only Gotenberg container, pinned by tag, on a Compose
network with `internal: true` that only `api` joins. It publishes no port. Its flags turn
JavaScript off, allow only `data:` and its own working files, and refuse private addresses.
The API adds a Content-Security-Policy as the first element of the head, limits the body (8
MiB), the time (30 s), the prints at once (2, refused as busy rather than queued) and the
requests per client, and logs size, duration and outcome, never the page.

**What was checked.** Against the real converter, a page with a script, an image, a
stylesheet, a frame and a `<meta http-equiv="refresh">` reached a local listener seven times
with no protection, and none with the converter's flags or with its network alone. The policy
alone is not enough: it does not stop the `<meta refresh>` navigation. It stays as a third
layer for subresources and scripts. A page that does navigate away is either printed or refused by the converter, depending
on whether the blocked navigation or the print comes first; nothing reaches the address
either way. A real document cannot carry one: the renderer's sanitizer removes `<meta>`.

**What it cannot do.** It prints the page the browser sent, so a caller can use it to print
any HTML they write (to a PDF only they receive), within the limits above. Comments and
pending suggestions never reach it: the Markdown the browser starts from holds only canonical
content (ADR 0006, ADR 0027).

## Considered options

- **Print from the browser (`window.print`).** Real text and no new service, but a print
  dialog instead of a download, and nothing the page controls: headers, footers, file name.
- **jsPDF with html2canvas.** One click, but the pages are pictures: text cannot be selected,
  files are large and rows are cut across pages.
- **Render the stored document on the server.** Authoritative, with no client HTML to distrust,
  but it needs a second renderer for every block, cannot draw Mermaid without a browser, and
  misses edits that have not synced.
- **A browser library inside the Go API.** One less container, but a browser in the API's
  image and process: a leak or a crash takes the API with it.
- **A LibreOffice route for Word.** It produces PDF from Office files, not Word from Markdown.
  Word is built in the browser; a pandoc service is the option to revisit if its fidelity
  (formulas are text in version one) becomes a complaint.

## Consequences

- Deployment: one container, one network, five settings. With `PDF_RENDER_URL` empty the
  feature is off and nothing else changes.
- Frontend: a sanitizer change in `drawDiagrams` (diagram labels are HTML inside
  `foreignObject` and were being removed, on the public page too), and `apiBlob` takes a
  request body and carries the server's message on a refusal.
- CI starts two converters (protected, and an unprotected control) and runs the isolation
  tests against them.
- Changing the converter's tag means checking its flag names again.
