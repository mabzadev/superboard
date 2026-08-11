#!/usr/bin/env node
import { createHash } from "node:crypto";
import { open, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { listFromPayload } from "./chatwoot-cutover/core.mjs";
import {
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";

const CONFIGURATION_COLLECTIONS = Object.freeze([
  "inboxes",
  "agents",
  "teams",
  "labels",
  "canned_responses",
  "custom_attribute_definitions",
  "automation_rules",
  "webhooks",
  "custom_filters",
  "agent_bots",
]);
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export async function exportChatwoot({
  baseUrl,
  accountId,
  outputDirectory,
  accessToken,
  attachmentHosts = [],
  fetchImpl = fetch,
}) {
  const base = validBaseUrl(baseUrl);
  const account = positiveInt(accountId, "--account-id");
  const destination = assertProtectedDirectory(outputDirectory);
  if (!accessToken?.trim()) throw new Error("CHATWOOT_API_ACCESS_TOKEN is required");
  await mkdir(destination, { mode: 0o700 });

  const allowedAttachmentHosts = new Set([base.hostname, ...attachmentHosts.map(normalizeHost)]);
  const requestJson = (path) => chatwootJson(fetchImpl, base, accessToken, path);
  const contacts = await paged(
    (page) => requestJson(`/api/v1/accounts/${account}/contacts?page=${page}&sort=created_at`),
    (payload) => listFromPayload(payload),
  );
  const conversations = await paged(
    (page) => requestJson(`/api/v1/accounts/${account}/conversations?assignee_type=all&status=all&page=${page}`),
    (payload) => listFromPayload(payload),
  );
  const configuration = {};
  for (const collection of CONFIGURATION_COLLECTIONS) {
    configuration[collection] = await requestJson(`/api/v1/accounts/${account}/${collection}`);
  }

  const contactsPath = join(destination, "contacts.ndjson");
  const conversationsPath = join(destination, "conversations.ndjson");
  const messagesPath = join(destination, "messages.ndjson");
  await writeNdjson(contactsPath, contacts);
  await writeNdjson(conversationsPath, conversations);
  await writeFile(join(destination, "configuration.json"), `${JSON.stringify(configuration)}\n`, { mode: 0o600, flag: "wx" });

  const messageFile = await open(messagesPath, "wx", 0o600);
  let messageCount = 0;
  let attachmentCount = 0;
  try {
    for (const conversation of conversations) {
      const conversationId = positiveInt(conversation.id, "conversation.id");
      const messages = await messagesAfter(requestJson, account, conversationId);
      for (const sourceMessage of messages) {
        const message = structuredClone(sourceMessage);
        const files = attachmentArray(message);
        const annotated = [];
        for (const [position, attachment] of files.entries()) {
          const copy = structuredClone(attachment);
          const sourceUrl = attachmentUrl(copy);
          if (sourceUrl) {
            const filename = safeFilename(copy.file_name ?? copy.filename ?? copy.name ?? `attachment-${position + 1}`);
            const relativePath = join(
              "attachments",
              String(conversationId),
              String(positiveInt(message.id, "message.id")),
              `${position}-${filename}`,
            );
            const absolutePath = join(destination, relativePath);
            await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
            const downloaded = await downloadAttachment(
              fetchImpl,
              sourceUrl,
              absolutePath,
              allowedAttachmentHosts,
              base.hostname,
              accessToken,
            );
            copy._opengrow_export = { relative_path: relativePath, ...downloaded };
            attachmentCount += 1;
          }
          annotated.push(copy);
        }
        if (Array.isArray(message.attachments)) message.attachments = annotated;
        else if (message.attachment && annotated[0]) message.attachment = annotated[0];
        await messageFile.write(`${JSON.stringify({ conversation_id: conversationId, message })}\n`);
        messageCount += 1;
      }
    }
  } finally {
    await messageFile.close();
  }

  const artifactPaths = [
    "contacts.ndjson",
    "conversations.ndjson",
    "messages.ndjson",
    "configuration.json",
  ];
  const artifacts = [];
  for (const path of artifactPaths) {
    const bytes = await readFile(join(destination, path));
    artifacts.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const manifest = {
    schema_version: 1,
    provider: "chatwoot",
    account_id: account,
    source_origin: base.origin,
    exported_at: new Date().toISOString(),
    counts: {
      contacts: contacts.length,
      conversations: conversations.length,
      messages: messageCount,
      attachments: attachmentCount,
    },
    artifacts,
  };
  await writeFile(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { directory: destination, manifest };
}

export function chatwootOriginFromTarget(target) {
  const definitions = (target?.publicSurfaceMonitors ?? [])
    .filter(({ id }) => id === "legacy-chatwoot");
  if (definitions.length !== 1) {
    throw new Error("Target must declare exactly one legacy-chatwoot public surface monitor");
  }
  const origin = validBaseUrl(definitions[0].url);
  const health = validBaseUrl(definitions[0].healthUrl ?? definitions[0].url);
  if (origin.origin !== health.origin) {
    throw new Error("legacy-chatwoot monitor URL and health URL must use the same origin");
  }
  return origin.origin;
}

export function assertProtectedDirectory(value) {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new Error("--output-directory must be an absolute path outside the Git repository");
  }
  const destination = resolve(value);
  const repositoryRelative = relative(root, destination);
  if (repositoryRelative === "" || (!repositoryRelative.startsWith("..") && !isAbsolute(repositoryRelative))) {
    throw new Error("Refusing to export customer data inside the Git repository");
  }
  return destination;
}

export async function paged(loader, selectRows, maximumPages = 10_000) {
  const rows = [];
  const seen = new Set();
  for (let page = 1; page <= maximumPages; page += 1) {
    const payload = await loader(page);
    const batch = selectRows(payload);
    if (batch.length === 0) return rows;
    let added = 0;
    for (const item of batch) {
      const key = String(item?.id ?? JSON.stringify(item));
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(item);
      added += 1;
    }
    if (added === 0) return rows;
  }
  throw new Error(`Chatwoot pagination exceeded ${maximumPages} pages`);
}

async function messagesAfter(requestJson, accountId, conversationId) {
  const rows = [];
  const seen = new Set();
  let after = 0;
  for (let page = 0; page < 100_000; page += 1) {
    const payload = await requestJson(
      `/api/v1/accounts/${accountId}/conversations/${conversationId}/messages?after=${after}`,
    );
    const batch = listFromPayload(payload);
    if (batch.length === 0) return rows;
    let next = after;
    for (const message of batch) {
      const id = positiveInt(message.id, "message.id");
      next = Math.max(next, id);
      if (!seen.has(id)) {
        seen.add(id);
        rows.push(message);
      }
    }
    if (next <= after) throw new Error(`Chatwoot message pagination stalled for conversation ${conversationId}`);
    after = next;
  }
  throw new Error(`Chatwoot message pagination exceeded its limit for conversation ${conversationId}`);
}

async function chatwootJson(fetchImpl, base, accessToken, path) {
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error("Chatwoot API path escaped its configured origin");
  const response = await retryFetch(fetchImpl, url, {
    headers: { Accept: "application/json", api_access_token: accessToken },
    redirect: "error",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Chatwoot API ${url.pathname} returned HTTP ${response.status}`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Chatwoot API ${url.pathname} returned invalid JSON`);
  }
}

async function downloadAttachment(fetchImpl, source, output, allowedHosts, chatwootHost, accessToken) {
  let url = new URL(source);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    validateAttachmentUrl(url, allowedHosts);
    const response = await retryFetch(fetchImpl, url, {
      headers: url.hostname === chatwootHost ? { api_access_token: accessToken } : {},
      redirect: "manual",
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Attachment redirect is missing Location");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error(`Chatwoot attachment returned HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_ATTACHMENT_BYTES) throw new Error("Chatwoot attachment exceeds 100 MiB");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error("Chatwoot attachment must contain between 1 byte and 100 MiB");
    }
    await writeFile(output, bytes, { mode: 0o600, flag: "wx" });
    return { bytes: bytes.byteLength, sha256: sha256(bytes) };
  }
  throw new Error("Chatwoot attachment exceeded three redirects");
}

async function retryFetch(fetchImpl, url, init) {
  let response;
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      response = await fetchImpl(url, init);
      if (response.status !== 429 && response.status < 500) return response;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(250 * (2 ** attempt), 2_000)));
  }
  if (!response) {
    throw new Error("Chatwoot request failed after five attempts", { cause: lastError });
  }
  return response;
}

function validBaseUrl(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("--base-url must be an HTTPS origin without embedded credentials");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  url.search = "";
  url.hash = "";
  return url;
}

function validateAttachmentUrl(url, allowedHosts) {
  if (url.protocol !== "https:" || url.username || url.password || !allowedHosts.has(url.hostname)) {
    throw new Error(`Attachment host ${url.hostname || "unknown"} is not allowlisted`);
  }
  if (/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(url.hostname)) {
    throw new Error("Private attachment hosts are not allowed");
  }
}

function attachmentArray(message) {
  if (Array.isArray(message.attachments)) return message.attachments.filter((item) => item && typeof item === "object");
  if (message.attachment && typeof message.attachment === "object") return [message.attachment];
  return [];
}

function attachmentUrl(attachment) {
  for (const field of ["data_url", "file_url", "download_url", "url"]) {
    if (typeof attachment[field] === "string" && attachment[field].startsWith("https://")) return attachment[field];
  }
  return null;
}

function normalizeHost(value) {
  const host = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/u.test(host)) throw new Error(`Invalid attachment host: ${value}`);
  return host;
}

function positiveInt(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${field} must be a positive integer`);
  return parsed;
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeNdjson(path, rows) {
  const file = await open(path, "wx", 0o600);
  try {
    for (const row of rows) await file.write(`${JSON.stringify(row)}\n`);
  } finally {
    await file.close();
  }
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const { target } = await loadTarget(targetName);
  if (!target.environments?.[environment]) {
    throw new Error(`Target ${targetName} does not define ${environment}`);
  }
  if (args["base-url"]) {
    throw new Error("--base-url is not accepted; declare legacy-chatwoot in the target manifest");
  }
  const result = await exportChatwoot({
    baseUrl: chatwootOriginFromTarget(target),
    accountId: process.env.CHATWOOT_ACCOUNT_ID,
    outputDirectory: args["output-directory"],
    accessToken: process.env.CHATWOOT_API_ACCESS_TOKEN,
    attachmentHosts: String(process.env.CHATWOOT_ATTACHMENT_HOSTS || "").split(",").filter(Boolean),
  });
  process.stdout.write(`${JSON.stringify({
    directory: result.directory,
    counts: result.manifest.counts,
    manifest_sha256: sha256(await readFile(join(result.directory, "manifest.json"))),
  }, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
