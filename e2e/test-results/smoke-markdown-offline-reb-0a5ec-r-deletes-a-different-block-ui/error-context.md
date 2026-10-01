# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui/specs/smoke/markdown-offline-rebase.spec.ts >> @live @smoke: an offline block move is applied after another user deletes a different block
- Location: ui/specs/smoke/markdown-offline-rebase.spec.ts:264:1

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
        - heading "Rebase doc 1790858415682" [level=1] [ref=f1e12] [cursor=pointer]
        - generic "Last saved at 7:40:15 PM" [ref=f1e14]: Saved
      - generic [ref=f1e19]:
        - generic [ref=f1e20]: Draft
        - button "Version History" [ref=f1e24] [cursor=pointer]
        - button "Share" [disabled]
        - button "Export" [ref=f1e25] [cursor=pointer]
    - generic [ref=f1e27]:
      - generic [ref=f1e28]:
        - button "View" [ref=f1e29] [cursor=pointer]
        - button "Edit" [ref=f1e30] [cursor=pointer]
        - generic [ref=f1e31]:
          - list "People in this document" [ref=f1e32]:
            - listitem "System Administrator (you)" [ref=f1e33]:
              - generic [ref=f1e34]: SA
          - status [ref=f1e36]: Synced
      - paragraph [ref=f1e41]: OFFLINE first
      - complementary [ref=f1e42]:
        - generic [ref=f1e43]:
          - button "Suggestions" [ref=f1e44] [cursor=pointer]
          - button "Suggest change" [ref=f1e45] [cursor=pointer]
  - region "Notifications alt+T"
```

# Test source

```ts
  181 |           };
  182 |           count.onerror = () => reject(count.error);
  183 |         };
  184 |       }),
  185 |   );
  186 | }
  187 | 
  188 | test("@live @smoke: offline edit merges after another user deletes an unrelated block", async ({
  189 |   browser,
  190 | }) => {
  191 |   test.setTimeout(90000);
  192 |   const baseURL = test.info().project.use.baseURL!;
  193 |   const a = await openClient(browser, baseURL);
  194 |   const b = await openClient(browser, baseURL);
  195 |   const doc = await createDocument(a.page, a.token);
  196 |   const editorA = await openEditor(a.page, doc.documentID, doc.workspaceID);
  197 |   const editorB = await openEditor(b.page, doc.documentID, doc.workspaceID);
  198 | 
  199 |   b.setOffline(true);
  200 |   await expect(b.page.getByRole("status").first()).toContainText("Offline");
  201 |   await editorB.click();
  202 |   await b.page.keyboard.press("Control+Home");
  203 |   await b.page.keyboard.type("OFFLINE ");
  204 | 
  205 |   await deleteBlock(a.page, a.token, doc, doc.ids.p2);
  206 | 
  207 |   b.setOffline(false);
  208 |   await expect(b.page.getByRole("status").first()).toContainText("Synced", {
  209 |     timeout: 30000,
  210 |   });
  211 |   await expect(b.page.getByText("Local changes were not applied")).toHaveCount(
  212 |     0,
  213 |   );
  214 |   await expect(
  215 |     b.page.getByRole("button", { name: /Export local changes/ }),
  216 |   ).toHaveCount(0);
  217 |   const editableB = b.page.locator('.ProseMirror[contenteditable="true"]');
  218 |   await expect(editableB).toContainText("OFFLINE first");
  219 |   await expect(editableB).not.toContainText("second");
  220 | 
  221 |   await expect(editorA).toContainText("OFFLINE first", { timeout: 15000 });
  222 |   await expect(editorA).not.toContainText("second");
  223 | 
  224 |   const persisted = await a.page.request.get(
  225 |     `${apiURL}/api/v1/documents/${doc.documentID}/body`,
  226 |     {
  227 |       headers: {
  228 |         Authorization: `Bearer ${a.token}`,
  229 |         "X-Workspace-Id": doc.workspaceID,
  230 |       },
  231 |     },
  232 |   );
  233 |   const stored = (await persisted.json()) as {
  234 |     data: { nodes: Array<{ content: string }> };
  235 |   };
  236 |   expect(stored.data.nodes.map((n) => n.content)).toContain("OFFLINE first");
  237 | });
  238 | 
  239 | test("@live @smoke: offline edit to a block deleted by another user stays available for review", async ({
  240 |   browser,
  241 | }) => {
  242 |   test.setTimeout(90000);
  243 |   const baseURL = test.info().project.use.baseURL!;
  244 |   const a = await openClient(browser, baseURL);
  245 |   const b = await openClient(browser, baseURL);
  246 |   const doc = await createDocument(a.page, a.token);
  247 |   await openEditor(a.page, doc.documentID, doc.workspaceID);
  248 |   const editorB = await openEditor(b.page, doc.documentID, doc.workspaceID);
  249 | 
  250 |   b.setOffline(true);
  251 |   await expect(b.page.getByRole("status").first()).toContainText("Offline");
  252 |   await editorB.click();
  253 |   await b.page.keyboard.press("Control+Home");
  254 |   await b.page.keyboard.type("LOST? ");
  255 | 
  256 |   await deleteBlock(a.page, a.token, doc, doc.ids.p1);
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
> 281 |     .toBe(1);
      |      ^ Error: Timeout 5000ms exceeded while waiting on the predicate
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
  357 |     .toBe(1);
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
```