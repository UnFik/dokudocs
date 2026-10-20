# HTML pages: security checks

ADR 0052 says a page may not be switched on for production until these checks
pass. The first group is automated and runs in CI; the second needs a real
content origin and is done by hand on staging before `CONTENT_ORIGIN` is set.

## Automated

| Scenario | Where |
| --- | --- |
| A page cannot read the application's cookies or storage, reach its DOM, navigate the window above it, or open a popup | `frontend/src/features/docs/lib/page-sandbox.browser.test.ts` ("cannot reach the application") |
| A page cannot send data out by `fetch`, XHR, WebSocket, beacon, EventSource, an image, CSS `url()`, a stylesheet, a script or iframe from another host, `<object>`, `<base>`, a font, or a worker; `eval` is off; a `data:` image and its own inline script work | same file ("cannot send anything out") |
| The policy those tests run under is the one the server sends | `TestThePolicyTheBrowserTestsRunUnderIsTheOneServed` (`backend/internal/application/htmlpage`), which keeps `testdata/content-csp.txt` equal to the served header |
| Weakening either the frame's `sandbox` attribute or the policy makes those tests fail | checked by hand when the tests were written (adding `allow-same-origin`, and opening `connect-src`) |
| The frame is `sandbox="allow-scripts"` with no `allow-same-origin` | `html-document-viewer.test.tsx` |
| Forged or foreign bridge messages do nothing: wrong source, not the bridge protocol, a capability the page did not declare, a download with no recent click, a file too large, a hostile file name or type | `page-bridge.test.ts` |
| The script a served page starts with and the bridge in the application agree: theme on ready, only declared capabilities, a download saved only after a click, the page's `dokudocs` object cannot be replaced | `frontend/src/features/docs/lib/page-bridge.browser.test.ts` (runs the real `bootstrap.js`) |
| The page reaches no state of any document (version 1 has none), and a capability is on only if the page declared it and this version has it | `TestOnlyDeclaredKnownCapabilitiesAreOn`, `page-bridge.test.ts` |
| A token for another key, a changed payload, or an expired token is refused; a login token is not a page token | `TestATokenFromAnotherKeyOrWithAChangedPayloadIsRefused`, `TestATokenNamesOneViewerAndOnePageAndExpires` |
| The address is refused after the viewer lost access, after the page was trashed, and without a content origin | `TestHTMLPageIsServedFromTheContentOriginToWhoeverCanStillRead` (integration), `TestRenderChecksTheViewersAccessAgainWhenTheFrameLoads` |
| The content host answers the page route and nothing else, and the page route answers on no other host | `content_host_test.go`, the integration test above |
| A page over 1 MiB (images as `data:` included) is refused | `TestHTMLDocumentBodyIsLimitedToOneMiB` |
| Text extraction ignores scripts and styles and survives unclosed, hostile or 5000-deep markup | `text_test.go` |
| Only an MCP client writes a page; chat reads only | `html_page_test.go`, `html_document_test.go` |

## On staging, by hand

Done against the real content origin, with two accounts and a page that tries
each of the following. Record the result in the pull request that sets
`CONTENT_ORIGIN`.

1. The page URL answers `Content-Security-Policy` starting `sandbox allow-scripts;`
   and `Cache-Control: no-store`, and the same path on the **application's** host
   answers 404.
2. Opening the page URL directly in a tab (not in the frame) still runs it in an
   opaque origin: `window.origin` is `null`, and `document.cookie` throws.
3. The application's own cookies and local storage are not readable from the
   page, with the browser's devtools on the page's frame.
4. A page that links a script from `https://evil.example` is blocked (console shows a
   policy violation).
5. After the second account is removed from the document, the old page URL it was given
   answers 404; after five minutes it answers 401.
6. The proxy does not forward `Cookie` to the API, and no response from the content
   origin carries `Set-Cookie`.

## Known limits

- A page can send its own frame to another address (`location = "https://…"`);
  no policy stops that. Version 1 gives a page no data of the viewer's or the
  workspace's, so there is nothing to carry out. Version 2 (viewer name, per-document
  state) must be built knowing this.
- The policy allows the page's own inline scripts, so that ordinary single-file pages
  work; `unsafe-eval` stays off. Script hosts are limited to five CDN hosts, but the
  policy cannot require a pinned version.
- A downloaded `.html` file has no policy at all when it is opened from disk. That is
  the person's own file; the viewer's banner says the page came through MCP.
- Pages written before text extraction existed have no indexed text until they are
  rewritten.
