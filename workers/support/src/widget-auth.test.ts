import { describe, expect, it } from "vitest";
import { encryptCredentialPayload } from "./secrets";
import type { Env } from "./types";
import { verifyWidgetIdentity } from "./widget-auth";

const nowSeconds = 1_800_000_000;
const encryptionKey = "widget-test-encryption-key";
const widgetKey = "widget-public-key";
const signingSecret = "widget-signing-secret";

type Endpoint = {
  id: string;
  project_id: number;
  settings_json: string;
  encrypted_payload: string;
};

async function environment(
  overrides: Partial<Endpoint> = {},
  allowedDomains: string[] = ["support.example.test", "*.tenant.example.test"],
): Promise<Env> {
  const endpoint: Endpoint = {
    id: "widget-endpoint-12",
    project_id: 12,
    settings_json: JSON.stringify({
      widget_key_hash: await sha256Hex(widgetKey),
    }),
    encrypted_payload: await encryptCredentialPayload(encryptionKey, {
      widget_key: widgetKey,
      signing_secret: signingSecret,
      allowed_domains: allowedDomains,
    }),
    ...overrides,
  };
  const database = {
    prepare: () => ({
      bind: () => ({ first: async () => endpoint }),
    }),
  } as unknown as D1Database;
  return {
    DB: database,
    SUPPORT_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
  } as Env;
}

async function signedRequest(options: {
  path?: string;
  method?: string;
  body?: string;
  project?: string;
  visitor?: string;
  origin?: string;
  timestamp?: number;
  idempotencyKey?: string;
  signature?: string;
} = {}): Promise<Request> {
  const path = options.path ?? "/conversations";
  const method = options.method ?? "POST";
  const body = options.body ?? JSON.stringify({ client_conversation_id: "client-1" });
  const project = options.project ?? "12";
  const visitor = options.visitor ?? "visitor-sensitive-value";
  const timestamp = options.timestamp ?? nowSeconds;
  const idempotencyKey = options.idempotencyKey ?? "widget-mutation-1";
  const canonicalPath = `/api/v1/support-widget${path}`;
  const canonical = [
    String(timestamp),
    method.toUpperCase(),
    canonicalPath,
    project,
    visitor,
    idempotencyKey,
    await sha256Hex(body),
  ].join("\n");
  const signature = options.signature ?? await hmacHex(signingSecret, canonical);
  return new Request(`https://support.internal/public/v1/widget${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      "origin": options.origin ?? "https://support.example.test",
      "x-superboard-project-id": project,
      "x-superboard-widget-key": widgetKey,
      "x-superboard-widget-visitor": visitor,
      "x-superboard-widget-signature": signature,
      "x-superboard-widget-timestamp": String(timestamp),
    },
    body,
  });
}

describe("Support widget authentication", () => {
  it("accepts the exact canonical HMAC and derives an opaque visitor identity", async () => {
    const identity = await verifyWidgetIdentity(
      await environment(),
      await signedRequest(),
      nowSeconds,
    );

    expect(identity).toMatchObject({
      projectId: 12,
      authentication: "widget_signature",
    });
    expect(identity.subject).toMatch(/^widget:[a-f0-9]{64}$/u);
    expect(identity.subject).not.toContain("visitor-sensitive-value");
    expect(identity.subject).not.toContain(widgetKey);
  });

  it("binds the signature to body, method, public path, project, visitor, and idempotency key", async () => {
    const env = await environment();
    const signed = await signedRequest();
    const vectors = [
      new Request(signed, { body: JSON.stringify({ client_conversation_id: "tampered" }) }),
      await signedRequest({ method: "PATCH" }),
      await signedRequest({ path: "/conversations/other" }),
      await signedRequest({ project: "13" }),
      await signedRequest({ visitor: "visitor-other" }),
      await signedRequest({ idempotencyKey: "widget-mutation-other" }),
    ];

    // Every vector is signed using its own changed value above. Replace its
    // signature with the original request signature to prove canonical binding.
    const originalSignature = signed.headers.get("x-superboard-widget-signature")!;
    for (const request of vectors) {
      request.headers.set("x-superboard-widget-signature", originalSignature);
      await expect(
        verifyWidgetIdentity(env, request, nowSeconds),
      ).rejects.toMatchObject({ code: "widget_identity_invalid", status: 401 });
    }
  });

  it("rejects malformed signatures and stale or future timestamps", async () => {
    const env = await environment();
    await expect(
      verifyWidgetIdentity(
        env,
        await signedRequest({ signature: "0".repeat(64) }),
        nowSeconds,
      ),
    ).rejects.toMatchObject({ code: "widget_identity_invalid", status: 401 });

    for (const timestamp of [nowSeconds - 301, nowSeconds + 301]) {
      await expect(
        verifyWidgetIdentity(env, await signedRequest({ timestamp }), nowSeconds),
      ).rejects.toMatchObject({ code: "widget_identity_invalid", status: 401 });
    }
  });

  it("accepts an exact or wildcard HTTPS domain and rejects an apex, sibling, or insecure origin", async () => {
    const env = await environment();
    await expect(
      verifyWidgetIdentity(env, await signedRequest(), nowSeconds),
    ).resolves.toMatchObject({ projectId: 12 });
    await expect(
      verifyWidgetIdentity(
        env,
        await signedRequest({ origin: "https://blue.tenant.example.test" }),
        nowSeconds,
      ),
    ).resolves.toMatchObject({ projectId: 12 });

    for (const origin of [
      "https://tenant.example.test",
      "https://blue.tenant.example.test.evil.test",
      "http://support.example.test",
    ]) {
      await expect(
        verifyWidgetIdentity(env, await signedRequest({ origin }), nowSeconds),
      ).rejects.toMatchObject({ code: "widget_domain_invalid", status: 403 });
    }
  });

  it("uses the configured endpoint as project authority and keeps subjects stable only within that endpoint", async () => {
    const request = await signedRequest({ project: "untrusted-project-reference" });
    const first = await verifyWidgetIdentity(await environment(), request, nowSeconds);
    const replay = await verifyWidgetIdentity(
      await environment(),
      await signedRequest({ project: "untrusted-project-reference" }),
      nowSeconds,
    );
    const otherVisitor = await verifyWidgetIdentity(
      await environment(),
      await signedRequest({
        project: "untrusted-project-reference",
        visitor: "visitor-other",
      }),
      nowSeconds,
    );
    const otherEndpoint = await verifyWidgetIdentity(
      await environment({ id: "widget-endpoint-other" }),
      await signedRequest({ project: "untrusted-project-reference" }),
      nowSeconds,
    );

    expect(first.projectId).toBe(12);
    expect(replay.subject).toBe(first.subject);
    expect(otherVisitor.subject).not.toBe(first.subject);
    expect(otherEndpoint.subject).not.toBe(first.subject);
  });
});

async function sha256Hex(value: string): Promise<string> {
  return hex(new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ));
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  ));
}

function hex(value: Uint8Array): string {
  return [...value]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
