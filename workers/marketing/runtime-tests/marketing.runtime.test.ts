import {
  signProjectContext,
  type InternalProjectContext,
} from "@opengrow/contracts/project-context";
import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
  SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { dispatchCampaign, handleMarketingQueue } from "../src/queue";
import { trackingToken } from "../src/tracking";
import { decryptJson } from "../src/secrets";

const secret = "marketing-runtime-secret";

async function signedRequest(
  path: string,
  projectId: number,
  method = "GET",
  body?: unknown,
  idempotencyKey?: string,
  role = "owner",
) {
  const context: InternalProjectContext = {
    module: "marketing",
    method,
    pathname: path,
    projectId,
    projectRef: projectId === 12 ? "10-test" : "10-prod",
    instanceId: 10,
    environment: projectId === 12 ? "test" : "production",
    actorId: role === "application" ? 0 : 2,
    role,
    requestId: crypto.randomUUID(),
    issuedAt: Math.floor(Date.now() / 1000),
  };
  const headers = new Headers({
    "content-type": "application/json",
    "x-internal-token": secret,
    "x-project-id": String(projectId),
    "x-project-ref": context.projectRef,
    "x-instance-id": "10",
    "x-environment": context.environment,
    "x-actor-id": String(context.actorId),
    "x-role": role,
    "x-request-id": context.requestId,
    "x-context-issued-at": String(context.issuedAt),
    "x-context-version": "1",
    "x-context-signature": await signProjectContext(context, secret),
  });
  if (role === "application") {
    headers.set("x-opengrow-application-user-id", "application-user-runtime");
    headers.set(
      "x-opengrow-application-email",
      "preference-runtime@example.com",
    );
    headers.set("x-opengrow-application-name", "Preference Runtime");
  }
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return new Request(`https://marketing.internal${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("Marketing in the Workers runtime", () => {
  it("persists authenticated application consent without exposing private lists or weakening suppressions", async () => {
    const projectId = 13;
    const publicListResponse = await SELF.fetch(
      await signedRequest(
        "/internal/v1/lists",
        projectId,
        "POST",
        {
          name: "Application product news",
          visibility: "public",
          optin_mode: "single",
        },
        "application-public-list",
      ),
    );
    expect(publicListResponse.status).toBe(201);
    const publicList = await publicListResponse.json<{
      data: { id: string };
    }>();
    const privateListResponse = await SELF.fetch(
      await signedRequest(
        "/internal/v1/lists",
        projectId,
        "POST",
        {
          name: "Application private operations",
          visibility: "private",
          optin_mode: "single",
        },
        "application-private-list",
      ),
    );
    const privateList = await privateListResponse.json<{
      data: { id: string };
    }>();

    const initial = await SELF.fetch(
      await signedRequest(
        "/internal/v1/application/preferences",
        projectId,
        "GET",
        undefined,
        undefined,
        "application",
      ),
    );
    expect(initial.status).toBe(200);
    const initialBody = await initial.json<{
      data: {
        consented: boolean;
        lists: Array<{ id: string; selected: boolean }>;
      };
    }>();
    expect(initialBody.data.consented).toBe(false);
    expect(initialBody.data.lists).toEqual([
      expect.objectContaining({ id: publicList.data.id, selected: false }),
    ]);
    expect(initialBody.data.lists).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: privateList.data.id }),
      ]),
    );

    const optedInRequest = () =>
      signedRequest(
        "/internal/v1/application/preferences",
        projectId,
        "PUT",
        {
          consented: true,
          attributes: { locale: "fr-CH", plan: "reference" },
          list_ids: [publicList.data.id],
        },
        "application-opt-in",
        "application",
      );
    const optedIn = await SELF.fetch(await optedInRequest());
    expect(optedIn.status).toBe(200);
    await expect(optedIn.json()).resolves.toMatchObject({
      data: {
        consented: true,
        email: "preference-runtime@example.com",
        status: "enabled",
        attributes: { locale: "fr-CH", plan: "reference" },
        lists: [
          expect.objectContaining({ id: publicList.data.id, selected: true }),
        ],
      },
    });
    const replay = await SELF.fetch(await optedInRequest());
    expect(replay.headers.get("idempotency-replayed")).toBe("true");

    await expect(
      env.DB.prepare(
        `
      SELECT application_user_id, consent_status, consent_source
      FROM subscribers WHERE project_id = ? AND email = 'preference-runtime@example.com'
    `,
      )
        .bind(projectId)
        .first(),
    ).resolves.toMatchObject({
      application_user_id: "application-user-runtime",
      consent_status: "confirmed",
      consent_source: "application",
    });
    await expect(
      env.DB.prepare(
        `
      SELECT COUNT(*) total FROM subscriber_list_memberships WHERE project_id = ? AND list_id = ?
    `,
      )
        .bind(projectId, publicList.data.id)
        .first(),
    ).resolves.toMatchObject({ total: 1 });

    const privateSelection = await SELF.fetch(
      await signedRequest(
        "/internal/v1/application/preferences",
        projectId,
        "PUT",
        {
          consented: true,
          list_ids: [privateList.data.id],
        },
        "application-private-selection",
        "application",
      ),
    );
    expect(privateSelection.status).toBe(422);
    await expect(privateSelection.json()).resolves.toMatchObject({
      error: { code: "list_ids_invalid" },
    });

    const optedOut = await SELF.fetch(
      await signedRequest(
        "/internal/v1/application/preferences",
        projectId,
        "PUT",
        {
          consented: false,
          list_ids: [],
        },
        "application-opt-out",
        "application",
      ),
    );
    expect(optedOut.status).toBe(200);
    await expect(optedOut.json()).resolves.toMatchObject({
      data: { consented: false, status: "unsubscribed" },
    });
    await env.DB.prepare(
      `
      UPDATE suppressions SET reason = 'complaint'
      WHERE project_id = ? AND email = 'preference-runtime@example.com'
    `,
    )
      .bind(projectId)
      .run();

    const forbiddenResubscribe = await SELF.fetch(
      await signedRequest(
        "/internal/v1/application/preferences",
        projectId,
        "PUT",
        {
          consented: true,
          list_ids: [publicList.data.id],
        },
        "application-resubscribe-complaint",
        "application",
      ),
    );
    expect(forbiddenResubscribe.status).toBe(409);
    await expect(forbiddenResubscribe.json()).resolves.toMatchObject({
      error: { code: "subscriber_suppressed" },
    });

    const repeatedOptOut = await SELF.fetch(
      await signedRequest(
        "/internal/v1/application/preferences",
        projectId,
        "PUT",
        {
          consented: false,
          list_ids: [],
        },
        "application-repeat-opt-out",
        "application",
      ),
    );
    expect(repeatedOptOut.status).toBe(200);
    await expect(
      env.DB.prepare(
        `
      SELECT reason FROM suppressions WHERE project_id = ? AND email = 'preference-runtime@example.com'
    `,
      )
        .bind(projectId)
        .first(),
    ).resolves.toMatchObject({ reason: "complaint" });

    const subscriberBeforeErasure = await env.DB.prepare(
      `
      SELECT id FROM subscribers
      WHERE project_id = ? AND application_user_id = 'application-user-runtime'
    `,
    )
      .bind(projectId)
      .first<{ id: string }>();
    expect(subscriberBeforeErasure?.id).toBeTruthy();
    const erased = await SELF.fetch(
      await signedRequest(
        "/internal/v1/application/users/application-user-runtime",
        projectId,
        "DELETE",
        undefined,
        "application-account-erasure",
        "application",
      ),
    );
    expect(erased.status).toBe(200);
    await expect(erased.json()).resolves.toMatchObject({
      data: {
        erased: true,
        subscribers_redacted: 1,
      },
    });
    const replayedErasure = await SELF.fetch(
      await signedRequest(
        "/internal/v1/application/users/application-user-runtime",
        projectId,
        "DELETE",
        undefined,
        "application-account-erasure",
        "application",
      ),
    );
    expect(replayedErasure.headers.get("idempotency-replayed")).toBe("true");
    const redacted = await env.DB.prepare(
      `
      SELECT email, name, status, attributes_json, consent_status,
        consent_source, application_user_id, optin_token_hash
      FROM subscribers WHERE project_id = ? AND id = ?
    `,
    )
      .bind(projectId, subscriberBeforeErasure!.id)
      .first<Record<string, unknown>>();
    expect(redacted).toMatchObject({
      name: null,
      status: "blocklisted",
      attributes_json: "{}",
      consent_status: "revoked",
      consent_source: "account_erasure",
      application_user_id: null,
      optin_token_hash: null,
    });
    expect(String(redacted?.email)).toMatch(
      /^erased\+[a-f0-9]{32}@invalid\.opengrow$/u,
    );
    await expect(
      env.DB.prepare(
        `
      SELECT reason, source, metadata_json FROM suppressions
      WHERE project_id = ? AND email = 'preference-runtime@example.com'
    `,
      )
        .bind(projectId)
        .first(),
    ).resolves.toMatchObject({
      reason: "privacy_delete",
      source: "account_erasure",
      metadata_json: "{}",
    });
    await expect(
      env.DB.prepare(
        `
      SELECT COUNT(*) total FROM subscriber_list_memberships
      WHERE project_id = ? AND subscriber_id = ?
    `,
      )
        .bind(projectId, subscriberBeforeErasure!.id)
        .first(),
    ).resolves.toMatchObject({ total: 0 });

    const ownerImpersonation = await SELF.fetch(
      await signedRequest(
        "/internal/v1/application/preferences",
        projectId,
        "GET",
        undefined,
        undefined,
        "owner",
      ),
    );
    expect(ownerImpersonation.status).toBe(403);
    await expect(ownerImpersonation.json()).resolves.toMatchObject({
      error: { code: "application_role_required" },
    });
  });

  it("persists subscribers, consent, lists, segments and campaigns with project isolation", async () => {
    const create = await SELF.fetch(
      await signedRequest(
        "/internal/v1/email/subscribers",
        12,
        "POST",
        {
          email: "customer@example.com",
          name: "Customer",
          attributes: { plan: "pro" },
        },
        "subscriber-create-1",
      ),
    );
    expect(create.status).toBe(201);
    const subscriber = await create.json<{ data: { id: string } }>();

    const replay = await SELF.fetch(
      await signedRequest(
        "/internal/v1/email/subscribers",
        12,
        "POST",
        {
          email: "customer@example.com",
          name: "Customer",
          attributes: { plan: "pro" },
        },
        "subscriber-create-1",
      ),
    );
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    await expect(replay.json()).resolves.toMatchObject({
      data: { id: subscriber.data.id },
    });

    const list = await SELF.fetch(
      await signedRequest(
        "/internal/v1/lists",
        12,
        "POST",
        { name: "Pro customers", visibility: "private" },
        "list-create-1",
      ),
    );
    expect(list.status).toBe(201);
    const segment = await SELF.fetch(
      await signedRequest(
        "/internal/v1/segments",
        12,
        "POST",
        {
          name: "Pro plan",
          rules: {
            mode: "all",
            conditions: [{ field: "plan", operator: "equals", value: "pro" }],
          },
        },
        "segment-create-1",
      ),
    );
    expect(segment.status).toBe(201);

    const campaign = await SELF.fetch(
      await signedRequest(
        "/internal/v1/campaigns",
        12,
        "POST",
        {
          name: "Welcome Pro",
          subject: "Welcome {{name}}",
          content_text: "Hello {{name}}",
          tracking_enabled: false,
        },
        "campaign-create-1",
      ),
    );
    expect(campaign.status).toBe(201);

    const projectRows = await SELF.fetch(
      await signedRequest("/internal/v1/email/subscribers", 12),
    );
    await expect(projectRows.json()).resolves.toMatchObject({
      data: [{ email: "customer@example.com" }],
    });
    const foreignRows = await SELF.fetch(
      await signedRequest("/internal/v1/email/subscribers", 11),
    );
    await expect(foreignRows.json()).resolves.toEqual({ data: [] });
  });

  it("encrypts stored SMTP credentials in D1", async () => {
    const response = await SELF.fetch(
      await signedRequest(
        "/internal/v1/settings/smtp",
        12,
        "PUT",
        {
          name: "Primary",
          host: "smtp.example.com",
          port: 587,
          security: "starttls",
          username: "mailer",
          password: "smtp-private-password",
          from_email: "hello@example.com",
          enabled: true,
        },
        "smtp-save-1",
      ),
    );
    expect(response.status).toBe(201);
    await expect(response.text()).resolves.not.toContain(
      "smtp-private-password",
    );
  });

  it("dispatches scheduled campaigns through the queue with at-least-once acknowledgement", async () => {
    const campaignId = crypto.randomUUID();
    await env.DB.prepare(
      `
      INSERT INTO campaigns (id, project_id, name, subject, status, tracking_enabled, updated_at)
      VALUES (?, ?, 'Empty audience', 'Nothing to send', 'scheduled', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `,
    )
      .bind(campaignId, 12)
      .run();
    const dispatch = await dispatchCampaign(env, {
      type: "marketing.campaign.dispatch",
      projectId: 12,
      campaignId,
    });
    expect(dispatch).toEqual({ dispatched: true, queued: 1 });
    const batch = createMessageBatch("marketing-test-delivery", [
      {
        id: "invalid-message",
        timestamp: new Date(),
        attempts: 1,
        body: { invalid: true },
      },
    ]);
    const execution = createExecutionContext();
    await handleMarketingQueue(batch, env);
    const result = await getQueueResult(batch, execution);
    expect(result.ackAll).toBe(false);
    expect(result.explicitAcks).toEqual(["invalid-message"]);
    await expect(
      env.DB.prepare("SELECT status FROM campaigns WHERE id = ?")
        .bind(campaignId)
        .first(),
    ).resolves.toMatchObject({ status: "running" });
    await expect(
      env.DB.prepare(
        "SELECT status FROM email_deliveries WHERE campaign_id = ?",
      )
        .bind(campaignId)
        .first(),
    ).resolves.toMatchObject({ status: "sending" });
  });

  it("durably quarantines a terminal delivery before acknowledging its DLQ message", async () => {
    const batch = createMessageBatch("marketing-test-delivery-dlq", [
      {
        id: "marketing-dead-letter-1",
        timestamp: new Date(),
        attempts: 6,
        body: {
          type: "marketing.campaign.dispatch",
          projectId: 12,
          campaignId: crypto.randomUUID(),
        },
      },
    ]);
    const execution = createExecutionContext();
    await handleMarketingQueue(batch, env);
    const result = await getQueueResult(batch, execution);
    expect(result.explicitAcks).toEqual(["marketing-dead-letter-1"]);
    await expect(
      env.DB.prepare(
        `
      SELECT source_queue, message_id, job_type, replayable, status FROM marketing_dead_letters
      WHERE message_id = 'marketing-dead-letter-1'
    `,
      ).first(),
    ).resolves.toMatchObject({
      source_queue: "marketing-test-delivery-dlq",
      message_id: "marketing-dead-letter-1",
      job_type: "marketing.campaign.dispatch",
      replayable: 1,
      status: "quarantined",
    });
  });

  it("reports accurate import upsert counts and deduplicates input emails", async () => {
    await env.DB.prepare(
      `
      INSERT INTO subscribers (id, project_id, email, status, attributes_json, consent_status, consent_source)
      VALUES (?, 12, 'existing@example.com', 'enabled', '{}', 'confirmed', 'test')
    `,
    )
      .bind(crypto.randomUUID())
      .run();
    const imported = await SELF.fetch(
      await signedRequest(
        "/internal/v1/email/subscribers-import",
        12,
        "POST",
        {
          subscribers: [
            { email: "existing@example.com", name: "Existing" },
            { email: "new@example.com", name: "First value" },
            { email: "NEW@example.com", name: "Last value" },
          ],
        },
        "subscriber-import-accurate",
      ),
    );
    expect(imported.status).toBe(202);
    await expect(imported.json()).resolves.toEqual({
      data: { received: 3, processed: 2, created: 1, updated: 1 },
    });
  });

  it("enforces owner/admin writes while retaining member reads", async () => {
    const write = await SELF.fetch(
      await signedRequest(
        "/internal/v1/lists",
        12,
        "POST",
        { name: "Forbidden list" },
        "member-write-1",
        "member",
      ),
    );
    expect(write.status).toBe(403);
    await expect(write.json()).resolves.toMatchObject({
      error: { code: "role_insufficient" },
    });
    const read = await SELF.fetch(
      await signedRequest(
        "/internal/v1/lists",
        12,
        "GET",
        undefined,
        undefined,
        "member",
      ),
    );
    expect(read.status).toBe(200);
  });

  it("queues double opt-in without exposing its token and confirms it publicly", async () => {
    const created = await SELF.fetch(
      await signedRequest(
        "/internal/v1/email/subscribers",
        12,
        "POST",
        {
          email: "optin@example.com",
          name: "Opt In",
          double_opt_in: true,
        },
        "subscriber-optin-1",
      ),
    );
    expect(created.status).toBe(201);
    const responseBody = await created.text();
    expect(responseBody).not.toContain("confirmation_token");
    const createdSubscriber = JSON.parse(responseBody) as {
      data: { id: string };
    };
    expect(createdSubscriber).toMatchObject({
      data: { confirmation_required: true, consent_status: "pending" },
    });
    const outbox = await env.DB.prepare(
      `
      SELECT resource_id, encrypted_payload, status FROM marketing_outbox WHERE project_id = 12 AND job_type = 'double_optin'
      ORDER BY created_at DESC LIMIT 1
    `,
    ).first<{
      resource_id: string;
      encrypted_payload: string;
      status: string;
    }>();
    expect(outbox?.status).toBe("dispatched");
    expect(outbox?.encrypted_payload).not.toContain("optin@example.com");
    const storedPending = await env.DB.prepare(
      "SELECT optin_token_hash FROM subscribers WHERE id = ?",
    )
      .bind(createdSubscriber.data.id)
      .first<{ optin_token_hash: string }>();
    expect(storedPending?.optin_token_hash).toBeTruthy();

    const subscriberResponses = await Promise.all([
      SELF.fetch(await signedRequest("/internal/v1/email/subscribers", 12)),
      SELF.fetch(
        await signedRequest(
          `/internal/v1/email/subscribers/${createdSubscriber.data.id}`,
          12,
        ),
      ),
      SELF.fetch(
        await signedRequest(
          `/internal/v1/email/subscribers/${createdSubscriber.data.id}/export`,
          12,
        ),
      ),
    ]);
    for (const subscriberResponse of subscriberResponses) {
      expect(subscriberResponse.status).toBe(200);
      const serialized = await subscriberResponse.text();
      expect(serialized).not.toContain(String(storedPending?.optin_token_hash));
      expect(serialized).not.toMatch(
        /project_id|optin_token_hash|optin_token_expires_at|attributes_json|list_ids_json/,
      );
    }

    const payload = await decryptJson<{ token: string }>(
      "marketing-encryption-secret",
      outbox!.encrypted_payload,
    );
    const confirmed = await SELF.fetch(
      `https://marketing.internal/public/v1/opt-in/${payload.token}`,
      { method: "POST" },
    );
    expect(confirmed.status).toBe(200);
    await expect(
      env.DB.prepare(
        "SELECT consent_status, optin_token_hash FROM subscribers WHERE id = ?",
      )
        .bind(outbox!.resource_id)
        .first(),
    ).resolves.toMatchObject({
      consent_status: "confirmed",
      optin_token_hash: null,
    });
    expect(
      (
        await SELF.fetch(
          `https://marketing.internal/public/v1/opt-in/${payload.token}`,
          { method: "POST" },
        )
      ).status,
    ).toBe(422);
  });

  it("deduplicates tracking and processes signed unsubscribe requests", async () => {
    const subscriberId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    const deliveryId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO subscribers (id, project_id, email, status, attributes_json, consent_status, consent_source) VALUES (?, 12, 'tracking@example.com', 'enabled', '{}', 'confirmed', 'test')`,
      ).bind(subscriberId),
      env.DB.prepare(
        `INSERT INTO campaigns (id, project_id, name, subject, status, tracking_enabled) VALUES (?, 12, 'Tracking', 'Tracking', 'running', 1)`,
      ).bind(campaignId),
      env.DB.prepare(
        `INSERT INTO email_deliveries (id, project_id, campaign_id, subscriber_id, recipient_email, status) VALUES (?, 12, ?, ?, 'tracking@example.com', 'sent')`,
      ).bind(deliveryId, campaignId, subscriberId),
    ]);
    const open = await trackingToken(env, {
      projectId: 12,
      deliveryId,
      subscriberId,
      campaignId,
      action: "open",
    });
    expect(
      (
        await SELF.fetch(
          `https://marketing.internal/public/v1/tracking/open/${open}`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await SELF.fetch(
          `https://marketing.internal/public/v1/tracking/open/${open}`,
        )
      ).status,
    ).toBe(200);
    await expect(
      env.DB.prepare(
        `SELECT COUNT(*) total FROM email_events WHERE delivery_id = ? AND event_type = 'open'`,
      )
        .bind(deliveryId)
        .first(),
    ).resolves.toMatchObject({ total: 1 });

    const unsubscribe = await trackingToken(env, {
      projectId: 12,
      deliveryId,
      subscriberId,
      campaignId,
      action: "unsubscribe",
    });
    const response = await SELF.fetch(
      `https://marketing.internal/public/v1/tracking/unsubscribe/${unsubscribe}`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    await expect(
      env.DB.prepare("SELECT status FROM subscribers WHERE id = ?")
        .bind(subscriberId)
        .first(),
    ).resolves.toMatchObject({ status: "unsubscribed" });
  });

  it("authenticates provider webhooks and suppresses complaints", async () => {
    const endpointResponse = await SELF.fetch(
      await signedRequest(
        "/internal/v1/settings/provider-webhooks",
        12,
        "POST",
        {
          provider: "generic",
          secret: "provider-webhook-secret",
          enabled: true,
        },
        "provider-endpoint-1",
      ),
    );
    expect(endpointResponse.status).toBe(201);
    const endpoint = await endpointResponse.json<{ data: { id: string } }>();
    const subscriberId = crypto.randomUUID();
    const campaignId = crypto.randomUUID();
    const deliveryId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO subscribers (id, project_id, email, status, attributes_json, consent_status, consent_source) VALUES (?, 12, 'complaint@example.com', 'enabled', '{}', 'confirmed', 'test')`,
      ).bind(subscriberId),
      env.DB.prepare(
        `INSERT INTO campaigns (id, project_id, name, subject, status, tracking_enabled) VALUES (?, 12, 'Complaint', 'Complaint', 'running', 1)`,
      ).bind(campaignId),
      env.DB.prepare(
        `INSERT INTO email_deliveries (id, project_id, campaign_id, subscriber_id, recipient_email, status) VALUES (?, 12, ?, ?, 'complaint@example.com', 'sent')`,
      ).bind(deliveryId, campaignId, subscriberId),
    ]);
    const url = `https://marketing.internal/public/v1/provider-webhooks/${endpoint.data.id}`;
    const body = JSON.stringify({
      event_type: "complaint",
      delivery_id: deliveryId,
      metadata: { provider_event_id: "event-1" },
    });
    const rejected = await SELF.fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-secret": "wrong-secret",
      },
      body,
    });
    expect(rejected.status).toBe(401);
    const accepted = await SELF.fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-secret": "provider-webhook-secret",
      },
      body,
    });
    expect(accepted.status).toBe(202);
    const duplicate = await SELF.fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-secret": "provider-webhook-secret",
      },
      body,
    });
    await expect(duplicate.json()).resolves.toMatchObject({
      data: { accepted: true, duplicate: true },
    });
    await expect(
      env.DB.prepare("SELECT status FROM subscribers WHERE id = ?")
        .bind(subscriberId)
        .first(),
    ).resolves.toMatchObject({ status: "blocklisted" });
    await expect(
      env.DB.prepare(
        "SELECT reason FROM suppressions WHERE project_id = 12 AND email = ?",
      )
        .bind("complaint@example.com")
        .first(),
    ).resolves.toMatchObject({ reason: "complaint" });
    await expect(
      env.DB.prepare(
        `SELECT COUNT(*) total FROM email_events WHERE delivery_id = ? AND event_type = 'complaint'`,
      )
        .bind(deliveryId)
        .first(),
    ).resolves.toMatchObject({ total: 1 });
  });
});
