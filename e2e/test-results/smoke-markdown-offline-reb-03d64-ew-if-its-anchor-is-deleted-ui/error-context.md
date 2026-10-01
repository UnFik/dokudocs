# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui/specs/smoke/markdown-offline-rebase.spec.ts >> @live @smoke: an offline block move stays for review if its anchor is deleted
- Location: ui/specs/smoke/markdown-offline-rebase.spec.ts:340:1

# Error details

```
Error: Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=f1e2]:
  - generic [ref=f1e6]:
    - banner [ref=f1e7]:
      - generic [ref=f1e8]:
        - button "Back" [ref=f1e9] [cursor=pointer]
        - generic [ref=f1e10]: Markdown
        - heading "Rebase doc 1790858458650" [level=1] [ref=f1e12] [cursor=pointer]
        - generic "Last saved at 7:40:58 PM" [ref=f1e14]: Saved
      - generic [ref=f1e19]:
        - generic [ref=f1e20]: Draft
        - button "Version History" [ref=f1e24] [cursor=pointer]
        - button "Share" [disabled]
        - button "Export" [ref=f1e25] [cursor=pointer]
    - generic [ref=f1e27]:
      - generic [ref=f1e28]:
        - button "View" [ref=f1e29] [cursor=pointer]
        - button "Edit" [active] [ref=f1e30] [cursor=pointer]
        - generic [ref=f1e31]:
          - list "People in this document" [ref=f1e32]:
            - listitem "System Administrator (you)" [ref=f1e33]:
              - generic [ref=f1e34]: SA
          - status [ref=f1e36]: Synced
      - generic [ref=f1e40]:
        - paragraph [ref=f1e41]: first
        - paragraph [ref=f1e42]: second
        - paragraph [ref=f1e43]: third
        - paragraph [ref=f1e44]: fourth
      - complementary [ref=f1e45]:
        - generic [ref=f1e46]:
          - button "Suggestions" [ref=f1e47] [cursor=pointer]
          - button "Suggest change" [ref=f1e48] [cursor=pointer]
  - region "Notifications alt+T"
```

# Test source

```ts
  257 | 
  258 |   b.setOffline(false);
  259 |   await expect(
  260 |     b.page.getByRole("button", { name: /Export local changes/ }),
  261 |   ).toBeVisible({ timeout: 30000 });
  262 | });
  263 | 
  264 | test("@live @smoke: an offline block move is applied after another user deletes a different block", async ({
  265 |   browser,
  266 | }) => {
  267 |   test.setTimeout(90000);
  268 |   const baseURL = test.info().project.use.baseURL!;
  269 |   const a = await openClient(browser, baseURL);
  270 |   const b = await openClient(browser, baseURL);
  271 |   const doc = await createDocument(a.page, a.token, true, true);
  272 |   const editorA = await openEditor(a.page, doc.documentID, doc.workspaceID);
  273 |   const editorB = await openEditor(b.page, doc.documentID, doc.workspaceID);
  274 | 
  275 |   b.setOffline(true);
  276 |   await expect(b.page.getByRole("status").first()).toContainText("Offline");
  277 |   await editorB.locator("p").filter({ hasText: "first" }).click();
  278 |   await b.page.keyboard.press("Alt+ArrowDown");
  279 |   await expect
  280 |     .poll(() => pendingCommandCount(b.page, "pending-move-commands"))
  281 |     .toBe(1);
  282 | 
  283 |   await deleteBlock(a.page, a.token, doc, doc.ids.p4);
  284 | 
  285 |   const moveResponses: number[] = [];
  286 |   b.page.on("response", (response) => {
  287 |     if (
  288 |       response.request().method() === "POST" &&
  289 |       new URL(response.url()).pathname ===
  290 |         `/api/v1/documents/${doc.documentID}/body/move`
  291 |     )
  292 |       moveResponses.push(response.status());
  293 |   });
  294 |   b.setOffline(false);
  295 |   await expect.poll(() => moveResponses.length).toBe(2);
  296 |   expect(moveResponses, "MoveNode response sequence").toEqual([409, 200]);
  297 |   await expect(b.page.getByRole("status").first()).toContainText("Synced", {
  298 |     timeout: 30000,
  299 |   });
  300 |   await expect(
  301 |     b.page.getByRole("button", { name: /Export local changes/ }),
  302 |   ).toHaveCount(0);
  303 | 
  304 |   const persisted = await a.page.request.get(
  305 |     `${apiURL}/api/v1/documents/${doc.documentID}/body`,
  306 |     {
  307 |       headers: {
  308 |         Authorization: `Bearer ${a.token}`,
  309 |         "X-Workspace-Id": doc.workspaceID,
  310 |       },
  311 |     },
  312 |   );
  313 |   const stored = (await persisted.json()) as {
  314 |     data: {
  315 |       nodes: Array<{
  316 |         nodeID: string;
  317 |         parentID: string | null;
  318 |         siblingOrder: number;
  319 |       }>;
  320 |     };
  321 |   };
  322 |   const rootID = stored.data.nodes.find(
  323 |     (node) => node.parentID === null,
  324 |   )!.nodeID;
  325 |   const rootChildren = stored.data.nodes
  326 |     .filter((node) => node.parentID === rootID)
  327 |     .sort((x, y) => x.siblingOrder - y.siblingOrder)
  328 |     .map((node) => node.nodeID);
  329 |   expect(rootChildren).toEqual([doc.ids.p2, doc.ids.p1, doc.ids.p3]);
  330 | 
  331 |   const paragraphsB = b.page.locator('.ProseMirror[contenteditable="true"] p');
  332 |   await expect(paragraphsB).toHaveText(["second", "first", "third"], {
  333 |     timeout: 15000,
  334 |   });
  335 |   await expect(editorA.locator("p")).toHaveText(["second", "first", "third"], {
  336 |     timeout: 15000,
  337 |   });
  338 | });
  339 | 
  340 | test("@live @smoke: an offline block move stays for review if its anchor is deleted", async ({
  341 |   browser,
  342 | }) => {
  343 |   test.setTimeout(90000);
  344 |   const baseURL = test.info().project.use.baseURL!;
  345 |   const a = await openClient(browser, baseURL);
  346 |   const b = await openClient(browser, baseURL);
  347 |   const doc = await createDocument(a.page, a.token, true, true);
  348 |   await openEditor(a.page, doc.documentID, doc.workspaceID);
  349 |   const editorB = await openEditor(b.page, doc.documentID, doc.workspaceID);
  350 | 
  351 |   b.setOffline(true);
  352 |   await expect(b.page.getByRole("status").first()).toContainText("Offline");
  353 |   await editorB.locator("p").filter({ hasText: "first" }).click();
  354 |   await b.page.keyboard.press("Alt+ArrowDown");
  355 |   await expect
  356 |     .poll(() => pendingCommandCount(b.page, "pending-move-commands"))
> 357 |     .toBe(1);
      |      ^ Error: Timeout 5000ms exceeded while waiting on the predicate
  358 | 
  359 |   await deleteBlock(a.page, a.token, doc, doc.ids.p3);
  360 | 
  361 |   const moveResponses: Array<{ status: number; commandID: string }> = [];
  362 |   b.page.on("response", (response) => {
  363 |     if (
  364 |       response.request().method() === "POST" &&
  365 |       new URL(response.url()).pathname ===
  366 |         `/api/v1/documents/${doc.documentID}/body/move`
  367 |     ) {
  368 |       moveResponses.push({
  369 |         status: response.status(),
  370 |         commandID: response.request().postDataJSON().commandID,
  371 |       });
  372 |     }
  373 |   });
  374 |   b.setOffline(false);
  375 |   await expect(b.page.getByRole("status").first()).toContainText(
  376 |     "recovery-required",
  377 |     { timeout: 30000 },
  378 |   );
  379 |   expect(moveResponses.length).toBeGreaterThan(0);
  380 |   expect(moveResponses.every(({ status }) => status === 409)).toBe(true);
  381 |   expect(new Set(moveResponses.map(({ commandID }) => commandID)).size).toBe(1);
  382 |   await expect
  383 |     .poll(() => pendingCommandCount(b.page, "pending-move-commands"))
  384 |     .toBe(1);
  385 |   await expect(
  386 |     b.page.getByRole("button", { name: /Export local changes/ }),
  387 |   ).toBeVisible();
  388 | 
  389 |   const persisted = await a.page.request.get(
  390 |     `${apiURL}/api/v1/documents/${doc.documentID}/body`,
  391 |     {
  392 |       headers: {
  393 |         Authorization: `Bearer ${a.token}`,
  394 |         "X-Workspace-Id": doc.workspaceID,
  395 |       },
  396 |     },
  397 |   );
  398 |   const stored = (await persisted.json()) as {
  399 |     data: {
  400 |       nodes: Array<{
  401 |         nodeID: string;
  402 |         parentID: string | null;
  403 |         siblingOrder: number;
  404 |       }>;
  405 |     };
  406 |   };
  407 |   const rootID = stored.data.nodes.find(
  408 |     (node) => node.parentID === null,
  409 |   )!.nodeID;
  410 |   const rootChildren = stored.data.nodes
  411 |     .filter((node) => node.parentID === rootID)
  412 |     .sort((x, y) => x.siblingOrder - y.siblingOrder)
  413 |     .map((node) => node.nodeID);
  414 |   expect(rootChildren).toEqual([doc.ids.p1, doc.ids.p2, doc.ids.p4]);
  415 | });
  416 | 
  417 | test("@live @smoke: an offline DeleteNode is replayed after an unrelated deletion", async ({
  418 |   browser,
  419 | }) => {
  420 |   test.setTimeout(90000);
  421 |   const baseURL = test.info().project.use.baseURL!;
  422 |   const a = await openClient(browser, baseURL);
  423 |   const b = await openClient(browser, baseURL);
  424 |   const doc = await createDocument(a.page, a.token, true);
  425 |   const editorA = await openEditor(a.page, doc.documentID, doc.workspaceID);
  426 |   const editorB = await openEditor(b.page, doc.documentID, doc.workspaceID);
  427 | 
  428 |   b.setOffline(true);
  429 |   await expect(b.page.getByRole("status").first()).toContainText("Offline");
  430 |   await editorB.locator("p").filter({ hasText: "second" }).click({
  431 |     clickCount: 3,
  432 |   });
  433 |   await b.page.keyboard.press("Backspace");
  434 |   await expect
  435 |     .poll(() => pendingCommandCount(b.page, "pending-delete-commands"))
  436 |     .toBe(1);
  437 | 
  438 |   await deleteBlock(a.page, a.token, doc, doc.ids.p3);
  439 | 
  440 |   const deleteResponses: Array<{ status: number; commandID: string }> = [];
  441 |   b.page.on("response", (response) => {
  442 |     if (
  443 |       response.request().method() === "POST" &&
  444 |       new URL(response.url()).pathname ===
  445 |         `/api/v1/documents/${doc.documentID}/body/delete`
  446 |     ) {
  447 |       deleteResponses.push({
  448 |         status: response.status(),
  449 |         commandID: response.request().postDataJSON().commandID,
  450 |       });
  451 |     }
  452 |   });
  453 |   b.setOffline(false);
  454 |   await expect.poll(() => deleteResponses.length).toBe(2);
  455 |   expect(deleteResponses.map(({ status }) => status)).toEqual([409, 200]);
  456 |   expect(deleteResponses[0]!.commandID).not.toBe(deleteResponses[1]!.commandID);
  457 |   await expect(b.page.getByRole("status").first()).toContainText("Synced", {
```