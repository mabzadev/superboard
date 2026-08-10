import assert from "node:assert/strict";
import test from "node:test";
import { renderChatwootSql, transformChatwootBundle } from "./core.mjs";

function fixture() {
  return {
    manifest: { account_id: 7 },
    configuration: {
      inboxes: [{ id: 2, name: "Mobile Support", channel_type: "Channel::Api" }],
      webhooks: [{
        id: 3,
        name: "Legacy hook",
        url: "https://hooks.example.test",
        secret_token: "must-not-migrate",
        nested: { credentials: { private_key: "nested-secret-must-not-migrate" }, label: "preserved" },
      }],
    },
    contacts: [{
      id: 10,
      identifier: "application-user-1",
      name: "Alice",
      email: "alice@example.test",
      custom_attributes: { plan: "premium" },
      created_at: 1_700_000_000,
    }],
    conversations: [{
      id: 20,
      status: "resolved",
      priority: "urgent",
      inbox_id: 2,
      created_at: 1_700_000_100,
      updated_at: 1_700_000_200,
      labels: ["vip"],
      meta: { sender: { id: 10, identifier: "application-user-1", name: "Alice" } },
      last_non_activity_message: { content: "Resolved" },
    }],
    messages: [{
      conversation_id: 20,
      message: {
        id: 30,
        conversation_id: 20,
        message_type: 0,
        sender_type: "Contact",
        sender_id: 10,
        content: "Screenshot attached",
        content_type: "text",
        status: "read",
        created_at: 1_700_000_150,
        attachments: [{
          id: 40,
          file_name: "proof.png",
          file_type: "image/png",
          _opengrow_export: {
            relative_path: "attachments/20/30/0-proof.png",
            bytes: 128,
            sha256: "a".repeat(64),
          },
        }],
      },
    }],
  };
}

test("Chatwoot conversion preserves identities, messages and every attachment", () => {
  const result = transformChatwootBundle(fixture(), { projectId: 12 });
  assert.equal(result.ready, true);
  assert.equal(result.rows.contacts[0].external_user_id, "application-user-1");
  assert.equal(result.rows.conversations[0].status, "closed");
  assert.equal(result.rows.conversations[0].priority, "urgent");
  assert.equal(result.rows.messages[0].sender_kind, "user");
  assert.equal(result.rows.messages[0].delivery_status, "read");
  assert.equal(result.rows.attachments.length, 1);
  assert.equal(result.uploads[0].relative_path, "attachments/20/30/0-proof.png");
  assert.equal(result.evidence.attachments.count, 1);

  const webhook = result.rows.configuration.find((item) => item.entity_type === "webhook");
  assert.equal(webhook.enabled, 0);
  assert.doesNotMatch(webhook.configuration_json, /must-not-migrate/u);
  assert.match(webhook.configuration_json, /preserved/u);
  const sql = renderChatwootSql(result);
  assert.match(sql, /INSERT INTO "support_message_attachments"/u);
  assert.doesNotMatch(sql, /BEGIN TRANSACTION|COMMIT/u);
});

test("Chatwoot conversion blocks unlinked identities and incomplete attachment exports", () => {
  const input = fixture();
  delete input.contacts[0].identifier;
  delete input.conversations[0].meta.sender.identifier;
  delete input.messages[0].message.attachments[0]._opengrow_export;
  const result = transformChatwootBundle(input, { projectId: 12 });
  assert.equal(result.ready, false);
  assert.deepEqual(new Set(result.blockers.map((item) => item.code)), new Set([
    "conversation_identity_missing",
    "attachment_export_missing",
  ]));
  assert.throws(() => renderChatwootSql(result), /migration is blocked/u);
});
