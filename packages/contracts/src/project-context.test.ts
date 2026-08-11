import { describe, expect, it } from "vitest";
import {
  PROJECT_CONTEXT_HEADERS,
  signProjectContext,
  verifyInternalProjectContextRequest,
  type InternalProjectContext,
} from "./project-context";

const context: InternalProjectContext = {
  module: "app",
  method: "GET",
  pathname: "/internal/v1",
  projectId: 11,
  projectRef: "12-test",
  instanceId: 12,
  environment: "test",
  actorId: 7,
  role: "admin",
  requestId: "rotation-test",
  issuedAt: 1_800_000_000,
};

async function request(token: string, signingSecret: string): Promise<Request> {
  return new Request("https://module.internal/internal/v1", {
    headers: {
      [PROJECT_CONTEXT_HEADERS.token]: token,
      [PROJECT_CONTEXT_HEADERS.projectId]: String(context.projectId),
      [PROJECT_CONTEXT_HEADERS.projectRef]: context.projectRef,
      [PROJECT_CONTEXT_HEADERS.instanceId]: String(context.instanceId),
      [PROJECT_CONTEXT_HEADERS.environment]: context.environment,
      [PROJECT_CONTEXT_HEADERS.actorId]: String(context.actorId),
      [PROJECT_CONTEXT_HEADERS.role]: context.role,
      [PROJECT_CONTEXT_HEADERS.requestId]: context.requestId,
      [PROJECT_CONTEXT_HEADERS.issuedAt]: String(context.issuedAt),
      [PROJECT_CONTEXT_HEADERS.version]: "1",
      [PROJECT_CONTEXT_HEADERS.signature]: await signProjectContext(
        context,
        signingSecret,
      ),
    },
  });
}

describe("project context secret overlap", () => {
  it("accepts a correctly paired current or previous token and signature", async () => {
    const secrets = ["current-secret", "previous-secret"];
    await expect(verifyInternalProjectContextRequest(
      await request(secrets[0], secrets[0]),
      secrets,
      "app",
      { nowSeconds: context.issuedAt },
    )).resolves.toMatchObject({ ok: true });
    await expect(verifyInternalProjectContextRequest(
      await request(secrets[1], secrets[1]),
      secrets,
      "app",
      { nowSeconds: context.issuedAt },
    )).resolves.toMatchObject({ ok: true });
  });

  it("rejects a token whose signature was made with the other overlap key", async () => {
    await expect(verifyInternalProjectContextRequest(
      await request("previous-secret", "current-secret"),
      ["current-secret", "previous-secret"],
      "app",
      { nowSeconds: context.issuedAt },
    )).resolves.toMatchObject({
      ok: false,
      code: "project_context_signature_invalid",
    });
  });
});
