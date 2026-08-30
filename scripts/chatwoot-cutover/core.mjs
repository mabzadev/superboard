import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { canonicalJson, upsertSql } from "../module-cutover/core.mjs";

const CONFIGURATION_TYPES = Object.freeze({
  inboxes: "inbox",
  agents: "agent",
  teams: "team",
  labels: "label",
  canned_responses: "canned_response",
  custom_attribute_definitions: "custom_attribute",
  automation_rules: "automation_rule",
  webhooks: "webhook",
  custom_filters: "saved_filter",
  agent_bots: "agent_bot",
});

const SUPPORT_PLUGIN_ID = "supbrd-plugmod-support";
const SUPPORT_STORE_BY_ENTITY = Object.freeze({
  contacts: "contacts",
  configuration: "conversations",
  conversations: "conversations",
  messages: "messages",
  attachments: "messages",
});

export const CHATWOOT_TABLES = Object.freeze([
  entity("contacts", "support_contacts", [
    "id", "project_id", "external_user_id", "name", "email", "phone",
    "avatar_url", "blocked", "custom_attributes_json", "last_seen_at",
    "created_at", "updated_at",
  ], ["id"], ["custom_attributes_json"]),
  entity("configuration", "support_configuration_entities", [
    "id", "project_id", "entity_type", "name", "enabled", "position",
    "configuration_json", "created_by", "updated_by", "created_at", "updated_at",
  ], ["id"], ["configuration_json"]),
  entity("conversations", "conversations", [
    "id", "project_id", "external_user_id", "client_conversation_id", "subject",
    "status", "priority", "assigned_user_id", "labels_json",
    "last_message_preview", "last_message_at", "user_last_read_at",
    "agent_last_read_at", "inbox_id", "assigned_team_id",
    "custom_attributes_json", "snoozed_until", "first_reply_at", "resolved_at",
    "created_at", "updated_at",
  ], ["id"], ["labels_json", "custom_attributes_json"]),
  entity("messages", "messages", [
    "id", "conversation_id", "sender_kind", "sender_id", "body",
    "attachment_key", "attachment_name", "attachment_content_type",
    "client_message_id", "sequence", "created_at", "visibility",
    "content_type", "reply_to_message_id", "metadata_json", "delivery_status",
  ], ["id"], ["metadata_json"]),
  entity("attachments", "support_message_attachments", [
    "id", "project_id", "conversation_id", "message_id", "storage_key",
    "file_name", "content_type", "byte_size", "position", "source_provider",
    "source_id", "created_at",
  ], ["id"]),
]);

export async function loadChatwootBundle(directory) {
  const bundleDirectory = resolve(directory);
  const manifest = JSON.parse(await readFile(join(bundleDirectory, "manifest.json"), "utf8"));
  const configuration = JSON.parse(await readFile(join(bundleDirectory, "configuration.json"), "utf8"));
  const bundle = {
    directory: bundleDirectory,
    manifest,
    configuration,
    contacts: await readNdjson(join(bundleDirectory, "contacts.ndjson")),
    conversations: await readNdjson(join(bundleDirectory, "conversations.ndjson")),
    messages: await readNdjson(join(bundleDirectory, "messages.ndjson")),
  };
  await verifyChatwootBundle(bundle);
  return bundle;
}

export async function verifyChatwootBundle(bundle) {
  if (bundle.manifest?.schema_version !== 1 || bundle.manifest?.provider !== "chatwoot") {
    throw new Error("Chatwoot export manifest is invalid");
  }
  const directory = resolve(bundle.directory || "");
  for (const artifact of bundle.manifest.artifacts || []) {
    const path = protectedBundlePath(directory, artifact.path);
    const bytes = await readFile(path);
    if (bytes.byteLength !== Number(artifact.bytes) || hash(bytes) !== artifact.sha256) {
      throw new Error(`Chatwoot export artifact checksum mismatch: ${artifact.path}`);
    }
  }
  for (const entry of bundle.messages || []) {
    const message = entry.message && typeof entry.message === "object" ? entry.message : entry;
    for (const attachment of attachmentArray(message)) {
      const exported = object(attachment._opengrow_export);
      if (!exported.relative_path) continue;
      const bytes = await readFile(protectedBundlePath(directory, exported.relative_path));
      if (bytes.byteLength !== Number(exported.bytes) || hash(bytes) !== exported.sha256) {
        throw new Error(`Chatwoot attachment checksum mismatch: ${exported.relative_path}`);
      }
    }
  }
  return true;
}

export function transformChatwootBundle(bundle, { projectId }) {
  if (!Number.isSafeInteger(projectId) || projectId < 1) throw new Error("projectId must be a positive integer");
  const accountId = positiveId(bundle.manifest?.account_id, "manifest.account_id");
  const blockers = [];
  const contactById = new Map();
  const contacts = uniqueBy(bundle.contacts || [], (contact) => String(contact.id)).map((contact) => {
    const sourceId = positiveId(contact.id, "contact.id");
    const externalUserId = optionalText(contact.identifier)
      || optionalText(contact.email)
      || `chatwoot-contact:${accountId}:${sourceId}`;
    contactById.set(String(sourceId), {
      externalUserId,
      applicationIdentifier: optionalText(contact.identifier),
    });
    return {
      id: sourceKey(accountId, "contact", sourceId),
      project_id: projectId,
      external_user_id: externalUserId,
      name: optionalText(contact.name),
      email: optionalText(contact.email),
      phone: optionalText(contact.phone_number),
      avatar_url: optionalText(contact.thumbnail),
      blocked: contact.blocked === true ? 1 : 0,
      custom_attributes_json: canonicalJson({
        ...(object(contact.custom_attributes)),
        _chatwoot: { id: sourceId, additional_attributes: object(contact.additional_attributes) },
      }),
      last_seen_at: timestamp(contact.last_activity_at),
      created_at: timestamp(contact.created_at) || new Date(0).toISOString(),
      updated_at: timestamp(contact.updated_at ?? contact.last_activity_at ?? contact.created_at) || new Date(0).toISOString(),
    };
  });

  const configuration = [];
  for (const [collection, entityType] of Object.entries(CONFIGURATION_TYPES)) {
    for (const [position, item] of listFromPayload(bundle.configuration?.[collection]).entries()) {
      const sourceId = String(item.id ?? position);
      const name = optionalText(item.name ?? item.title ?? item.short_code ?? item.display_name)
        || `${entityType} ${sourceId}`;
      const sanitized = sanitizeConfiguration(item, entityType);
      configuration.push({
        id: sourceKey(accountId, entityType, sourceId),
        project_id: projectId,
        entity_type: entityType,
        name,
        enabled: item.enabled === false || item.status === "disabled" || entityType === "webhook" ? 0 : 1,
        position,
        configuration_json: canonicalJson(sanitized),
        created_by: "chatwoot-migration",
        updated_by: "chatwoot-migration",
        created_at: timestamp(item.created_at) || new Date(0).toISOString(),
        updated_at: timestamp(item.updated_at ?? item.created_at) || new Date(0).toISOString(),
      });
    }
  }

  const conversationById = new Map();
  const conversations = uniqueBy(bundle.conversations || [], (conversation) => String(conversation.id)).map((conversation) => {
    const sourceId = positiveId(conversation.id, "conversation.id");
    const sender = object(conversation.meta?.sender);
    const contactSourceId = String(sender.id ?? conversation.contact_id ?? "");
    const knownContact = contactById.get(contactSourceId);
    const externalUserId = optionalText(sender.identifier)
      || knownContact?.applicationIdentifier;
    if (!externalUserId) {
      blockers.push({
        code: "conversation_identity_missing",
        conversation_id: sourceId,
        message: "Chatwoot conversation has no contact identifier or email and cannot be attached to an application identity.",
      });
    }
    const id = sourceKey(accountId, "conversation", sourceId);
    conversationById.set(String(sourceId), id);
    const status = conversation.status === "resolved"
      ? "closed"
      : conversation.status === "pending" || conversation.status === "snoozed"
        ? "pending"
        : "open";
    const createdAt = timestamp(conversation.created_at ?? conversation.timestamp) || new Date(0).toISOString();
    const updatedAt = timestamp(conversation.updated_at ?? conversation.last_activity_at) || createdAt;
    return {
      id,
      project_id: projectId,
      external_user_id: externalUserId || `blocked-chatwoot-contact:${accountId}:${contactSourceId || sourceId}`,
      client_conversation_id: `chatwoot:${accountId}:${sourceId}`,
      subject: optionalText(
        conversation.custom_attributes?.subject
          ?? conversation.additional_attributes?.mail_subject
          ?? conversation.meta?.sender?.name,
      ) || `Chatwoot conversation #${sourceId}`,
      status,
      priority: ["low", "normal", "high", "urgent"].includes(conversation.priority)
        ? conversation.priority
        : "normal",
      assigned_user_id: conversation.meta?.assignee?.id == null ? null : sourceKey(accountId, "agent", conversation.meta.assignee.id),
      labels_json: canonicalJson(Array.isArray(conversation.labels) ? conversation.labels : []),
      last_message_preview: optionalText(conversation.last_non_activity_message?.content)?.slice(0, 1000) || null,
      last_message_at: timestamp(conversation.last_activity_at),
      user_last_read_at: timestamp(conversation.contact_last_seen_at),
      agent_last_read_at: timestamp(conversation.agent_last_seen_at ?? conversation.assignee_last_seen_at),
      inbox_id: conversation.inbox_id == null ? null : sourceKey(accountId, "inbox", conversation.inbox_id),
      assigned_team_id: conversation.team?.id == null && conversation.team_id == null
        ? null
        : sourceKey(accountId, "team", conversation.team?.id ?? conversation.team_id),
      custom_attributes_json: canonicalJson({
        ...object(conversation.custom_attributes),
        _chatwoot: { id: sourceId, uuid: conversation.uuid ?? null, additional_attributes: object(conversation.additional_attributes) },
      }),
      snoozed_until: timestamp(conversation.snoozed_until),
      first_reply_at: timestamp(conversation.first_reply_created_at),
      resolved_at: status === "closed" ? updatedAt : null,
      created_at: createdAt,
      updated_at: updatedAt,
    };
  });

  const messages = [];
  const attachments = [];
  const uploads = [];
  const grouped = new Map();
  for (const entry of bundle.messages || []) {
    const message = entry.message && typeof entry.message === "object" ? entry.message : entry;
    const sourceConversationId = String(entry.conversation_id ?? message.conversation_id ?? "");
    const targetConversationId = conversationById.get(sourceConversationId);
    if (!targetConversationId) {
      blockers.push({ code: "message_conversation_missing", message_id: message.id ?? null, conversation_id: sourceConversationId });
      continue;
    }
    const items = grouped.get(targetConversationId) || [];
    items.push(message);
    grouped.set(targetConversationId, items);
  }
  for (const [conversationId, sourceMessages] of grouped) {
    sourceMessages.sort(compareMessages);
    for (const [offset, message] of sourceMessages.entries()) {
      const sourceId = positiveId(message.id, "message.id");
      const id = sourceKey(accountId, "message", sourceId);
      const files = attachmentArray(message);
      const normalizedAttachments = files.map((attachment, position) => {
        const exported = object(attachment._opengrow_export);
        const attachmentSourceId = String(attachment.id ?? `${sourceId}-${position}`);
        const filename = safeFilename(attachment.file_name ?? attachment.filename ?? attachment.name ?? `attachment-${position + 1}`);
        const storageKey = `support/${projectId}/chatwoot/${accountId}/${conversationId}/${id}/${position}-${filename}`;
        if (!exported.relative_path || !exported.sha256 || !Number.isSafeInteger(exported.bytes)) {
          blockers.push({ code: "attachment_export_missing", message_id: sourceId, attachment_id: attachmentSourceId });
        } else {
          uploads.push({
            storage_key: storageKey,
            relative_path: String(exported.relative_path),
            bytes: Number(exported.bytes),
            sha256: String(exported.sha256),
            content_type: optionalText(attachment.file_type ?? attachment.content_type) || "application/octet-stream",
          });
        }
        return {
          id: sourceKey(accountId, "attachment", attachmentSourceId),
          project_id: projectId,
          conversation_id: conversationId,
          message_id: id,
          storage_key: storageKey,
          file_name: filename,
          content_type: optionalText(attachment.file_type ?? attachment.content_type) || "application/octet-stream",
          byte_size: Number.isSafeInteger(exported.bytes) ? Number(exported.bytes) : null,
          position,
          source_provider: "chatwoot",
          source_id: attachmentSourceId,
          created_at: timestamp(message.created_at) || new Date(0).toISOString(),
        };
      });
      attachments.push(...normalizedAttachments);
      const primary = normalizedAttachments[0] || null;
      const originalContentType = optionalText(message.content_type) || "text";
      messages.push({
        id,
        conversation_id: conversationId,
        sender_kind: senderKind(message),
        sender_id: message.sender_id == null ? `chatwoot:${senderKind(message)}` : sourceKey(accountId, senderKind(message), message.sender_id),
        body: optionalText(message.content) || (primary ? null : "[Chatwoot activity]"),
        attachment_key: primary?.storage_key ?? null,
        attachment_name: primary?.file_name ?? null,
        attachment_content_type: primary?.content_type ?? null,
        client_message_id: `chatwoot:${accountId}:${sourceId}`,
        sequence: offset + 1,
        created_at: timestamp(message.created_at) || new Date(0).toISOString(),
        visibility: message.private === true ? "private" : "public",
        content_type: ["text", "input_email", "input_select", "cards", "form", "activity"].includes(originalContentType)
          ? originalContentType
          : Number(message.message_type) === 2 ? "activity" : "text",
        reply_to_message_id: message.content_attributes?.in_reply_to == null
          ? null
          : sourceKey(accountId, "message", message.content_attributes.in_reply_to),
        metadata_json: canonicalJson({
          ...object(message.content_attributes),
          _chatwoot: {
            id: sourceId,
            message_type: message.message_type ?? null,
            content_type: originalContentType,
            source_id: message.source_id ?? null,
            attachment_count: normalizedAttachments.length,
          },
        }),
        delivery_status: ["sent", "delivered", "read", "failed"].includes(message.status) ? message.status : "sent",
      });
    }
  }

  const rows = { contacts, configuration, conversations, messages, attachments };
  const evidence = Object.fromEntries(CHATWOOT_TABLES.map((table) => [
    table.id,
    datasetEvidence(rows[table.id]),
  ]));
  return {
    schema_version: 1,
    source: { provider: "chatwoot", account_id: accountId },
    target: { project_id: projectId },
    ready: blockers.length === 0,
    blockers,
    evidence,
    rows,
    uploads,
  };
}

export function renderChatwootSql(transformation) {
  if (!transformation.ready) {
    throw new Error(`Chatwoot migration is blocked: ${transformation.blockers.map((item) => item.code).join(", ")}`);
  }
  // Wrangler D1 file execution is not globally atomic. Every statement is an
  // idempotent upsert so an interrupted import can be safely resumed.
  const statements = [];
  for (const table of CHATWOOT_TABLES) {
    statements.push(upsertSql(table, transformation.rows[table.id]));
  }
  statements.push("");
  return statements.join("\n");
}

function entity(id, table, columns, keys, jsonColumns = []) {
  const storeName = SUPPORT_STORE_BY_ENTITY[id];
  if (!storeName) throw new Error(`Chatwoot entity ${id} has no canonical support Store`);
  return {
    id,
    module: "support",
    target: { table },
    columns,
    keys,
    jsonColumns,
    pluginId: SUPPORT_PLUGIN_ID,
    storeId: `${SUPPORT_PLUGIN_ID}.store.${storeName}`,
    repositoryId: `${SUPPORT_PLUGIN_ID}.repository.${table}`,
  };
}

function datasetEvidence(rows) {
  const encoded = rows.map(canonicalJson).sort().join("\n");
  return { count: rows.length, checksum: hash(encoded) };
}

function sourceKey(accountId, type, sourceId) {
  const value = String(sourceId ?? "").trim();
  if (!value || value.length > 255) throw new Error(`${type} source id is invalid`);
  return `chatwoot:${accountId}:${type}:${value}`;
}

function positiveId(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${field} must be a positive integer`);
  return parsed;
}

function timestamp(value) {
  if (value == null || value === "") return null;
  const date = typeof value === "number" || /^\d+(?:\.\d+)?$/u.test(String(value))
    ? new Date(Number(value) * 1000)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function optionalText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function listFromPayload(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.payload)) return value.payload;
  if (Array.isArray(value?.data?.payload)) return value.data.payload;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function sanitizeConfiguration(item, entityType) {
  const value = redactSecrets(structuredClone(object(item)));
  value._chatwoot = { id: item.id ?? null, type: entityType };
  if (entityType === "webhook") {
    value.enabled_after_secret_rotation = false;
  }
  return value;
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  for (const key of Object.keys(value)) {
    if (/token|secret|password|api[_-]?key|credential|private[_-]?key/i.test(key)) {
      delete value[key];
      continue;
    }
    value[key] = redactSecrets(value[key]);
  }
  return value;
}

function attachmentArray(message) {
  if (Array.isArray(message.attachments)) return message.attachments.filter((item) => item && typeof item === "object");
  if (message.attachment && typeof message.attachment === "object") return [message.attachment];
  return [];
}

function senderKind(message) {
  if (message.sender_type === "Contact" || Number(message.message_type) === 0) return "user";
  if (message.sender_type === "User" || Number(message.message_type) === 1) return "agent";
  return "system";
}

function compareMessages(left, right) {
  const timeDifference = (Date.parse(timestamp(left.created_at) || "") || 0)
    - (Date.parse(timestamp(right.created_at) || "") || 0);
  return timeDifference || Number(left.id) - Number(right.id);
}

function safeFilename(value) {
  const normalized = String(value || "attachment")
    .normalize("NFKC")
    .replace(/[\\/\0\r\n]/gu, "_")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim()
    .slice(0, 120);
  return normalized || "attachment";
}

function uniqueBy(rows, key) {
  return [...new Map(rows.map((row) => [key(row), row])).values()];
}

async function readNdjson(path) {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

function protectedBundlePath(directory, value) {
  if (typeof value !== "string" || value === "" || isAbsolute(value)) {
    throw new Error("Chatwoot export contains an invalid relative artifact path");
  }
  const path = resolve(directory, value);
  const fromBundle = relative(directory, path);
  if (fromBundle.startsWith("..") || isAbsolute(fromBundle)) {
    throw new Error("Chatwoot export artifact escaped its bundle directory");
  }
  return path;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
