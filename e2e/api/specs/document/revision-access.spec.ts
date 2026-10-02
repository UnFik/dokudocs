import { randomUUID } from "node:crypto";
import { test, expect } from "../../fixtures/test-base";
import { generateUser, generateWorkspace } from "../../helpers/factory";

test("document revisions enforce current read and edit access", async ({
  userRequest,
  userContext,
  request,
  playwright,
}) => {
  const workspaceResponse = await userRequest.post("/api/v1/workspaces", {
    data: generateWorkspace(),
  });
  expect(workspaceResponse.status()).toBe(201);
  const workspace = (await workspaceResponse.json()).data;
  const baseURL = process.env.API_URL || "http://localhost:8080";
  const ownerRequest = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: {
      Authorization: `Bearer ${userContext.token}`,
      "X-Workspace-Id": workspace.id,
      "Content-Type": "application/json",
    },
  });

  const memberData = generateUser();
  const registrationResponse = await request.post("/api/v1/auth/register", {
    data: memberData,
  });
  expect(registrationResponse.status()).toBe(201);
  const member = (await registrationResponse.json()).data;
  const inviteResponse = await userRequest.post(
    `/api/v1/workspaces/${workspace.id}/invites`,
    {
      data: { email: memberData.email, role: "member" },
    },
  );
  expect(inviteResponse.ok()).toBeTruthy();

  const memberRequest = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: {
      Authorization: `Bearer ${member.accessToken}`,
      "X-Workspace-Id": workspace.id,
      "Content-Type": "application/json",
    },
  });

  const createMarkdown = async (title: string, isDraft = false) => {
    const documentID = randomUUID();
    const rootNodeID = randomUUID();
    const response = await ownerRequest.post("/api/v1/documents", {
      headers: { "Idempotency-Key": randomUUID() },
      data: {
        title,
        type: "markdown",
        visibility: "private",
        isDraft,
        initialBody: {
          documentID,
          bodySchemaVersion: 1,
          rootNodeID,
          nodes: [
            {
              nodeID: rootNodeID,
              parentID: null,
              siblingOrder: 0,
              type: "document",
              content: "",
              attributes: {},
            },
            {
              nodeID: randomUUID(),
              parentID: rootNodeID,
              siblingOrder: 1,
              type: "paragraph",
              content: title,
              attributes: {},
            },
          ],
        },
      },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).data as { id: string };
  };

  try {
    const viewableDocument = await createMarkdown("Readable revision");
    const draftDocument = await createMarkdown("Draft revision", true);
    for (const document of [viewableDocument, draftDocument]) {
      const grantResponse = await ownerRequest.post(
        `/api/v1/documents/${document.id}/accesses`,
        {
          data: { email: memberData.email, level: "view" },
        },
      );
      expect(grantResponse.status()).toBe(201);
    }

    const sourceRevisionResponse = await ownerRequest.post(
      `/api/v1/documents/${viewableDocument.id}/revisions`,
      { data: { title: "Initial snapshot" } },
    );
    expect(sourceRevisionResponse.status()).toBe(201);
    const sourceRevision = (await sourceRevisionResponse.json()).data;

    expect(
      (
        await memberRequest.get(
          `/api/v1/documents/${viewableDocument.id}/revisions`,
        )
      ).status(),
    ).toBe(200);
    expect(
      (
        await memberRequest.post(
          `/api/v1/documents/${viewableDocument.id}/revisions`,
          {
            data: { title: "Not allowed" },
          },
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await memberRequest.post(
          `/api/v1/documents/${viewableDocument.id}/revisions/${sourceRevision.id}/restore`,
          { headers: { "Idempotency-Key": randomUUID() } },
        )
      ).status(),
    ).toBe(403);

    expect(
      (
        await memberRequest.get(
          `/api/v1/documents/${draftDocument.id}/revisions`,
        )
      ).status(),
    ).toBe(404);

    const promoteDraftGrantResponse = await ownerRequest.post(
      `/api/v1/documents/${draftDocument.id}/accesses`,
      { data: { email: memberData.email, level: "edit" } },
    );
    expect(promoteDraftGrantResponse.status()).toBe(201);
    expect(
      (
        await memberRequest.get(
          `/api/v1/documents/${draftDocument.id}/revisions`,
        )
      ).status(),
    ).toBe(200);
    const draftRevisionResponse = await memberRequest.post(
      `/api/v1/documents/${draftDocument.id}/revisions`,
      { data: { title: "Editor snapshot" } },
    );
    expect(draftRevisionResponse.status()).toBe(201);
    const draftRevision = (await draftRevisionResponse.json()).data;
    expect(
      (
        await memberRequest.post(
          `/api/v1/documents/${draftDocument.id}/revisions/${draftRevision.id}/restore`,
          { headers: { "Idempotency-Key": randomUUID() } },
        )
      ).status(),
    ).toBe(200);

    const trashResponse = await ownerRequest.delete(
      `/api/v1/documents/${viewableDocument.id}`,
    );
    expect(trashResponse.status()).toBe(200);
    expect(
      (
        await memberRequest.get(
          `/api/v1/documents/${viewableDocument.id}/revisions`,
        )
      ).status(),
    ).toBe(404);
  } finally {
    await memberRequest.dispose();
    await ownerRequest.dispose();
  }
});
