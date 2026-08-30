import { describe, expect, it } from "vitest";
import {
  completeIntegrationOAuth,
  startIntegrationOAuth,
} from "./integration-oauth";

const untouchedDb = {
  prepare: () => {
    throw new Error("D1 must not be touched for a rejected public input");
  },
} as unknown as D1Database;

describe("native Support integration authorization", () => {
  it("leaves non-integration opaque states to the channel callback", async () => {
    await expect(completeIntegrationOAuth(
      {
        DB: untouchedDb,
        SUPPORT_CREDENTIAL_ENCRYPTION_KEY: "integration-state-key",
      },
      new Request("https://support.example.test/callback?state=channel-state"),
      "slack",
    )).resolves.toEqual({ handled: false });
  });

  it("rejects a tampered signed-state envelope before querying D1", async () => {
    await expect(completeIntegrationOAuth(
      {
        DB: untouchedDb,
        SUPPORT_CREDENTIAL_ENCRYPTION_KEY: "integration-state-key",
      },
      new Request(`https://support.example.test/callback?state=si1.${"a".repeat(43)}.${"b".repeat(43)}`),
      "slack",
    )).rejects.toMatchObject({ code: "support_oauth_state_invalid", status: 422 });
  });

  it("rejects private callback and return targets before loading credentials", async () => {
    await expect(startIntegrationOAuth(
      {
        DB: untouchedDb,
        SUPPORT_CREDENTIAL_ENCRYPTION_KEY: "integration-state-key",
      },
      {
        projectId: 12,
        integrationId: "integration-1",
        callbackUri: "https://127.0.0.1/oauth/callback",
        returnUri: "https://dashboard.example.test/support/integrations",
        actorId: "agent-1",
      },
    )).rejects.toMatchObject({ code: "support_oauth_uri_invalid", status: 422 });
  });
});
