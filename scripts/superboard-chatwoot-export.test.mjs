import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  assertProtectedDirectory,
  chatwootOriginFromTarget,
  exportChatwoot,
  paged,
} from "./superboard-chatwoot-export.mjs";
import { loadChatwootBundle } from "./chatwoot-cutover/core.mjs";
import { loadRenderedChatwoot } from "./chatwoot-cutover/apply.mjs";
import { buildChatwootCutover, renderArtifacts } from "./superboard-chatwoot-cutover.mjs";
import { loadTarget, root } from "./cloudflare-target.mjs";

test("Chatwoot export paginates API data, downloads allowlisted files and emits checksums", async () => {
  const parent = await mkdtemp(join(tmpdir(), "superboard-chatwoot-export-"));
  const output = join(parent, "snapshot");
  const requests = [];
  try {
    const fetchImpl = async (input, init = {}) => {
      const url = new URL(input);
      requests.push({ url: url.toString(), headers: init.headers || {} });
      if (url.hostname === "files.example.test") {
        return new Response("attachment-content", { status: 200, headers: { "content-length": "18" } });
      }
      if (url.pathname.endsWith("/contacts")) {
        return Response.json({ payload: url.searchParams.get("page") === "1" ? [{ id: 10, identifier: "user-1" }] : [] });
      }
      if (url.pathname.endsWith("/conversations")) {
        return Response.json({ data: { payload: url.searchParams.get("page") === "1" ? [{
          id: 20,
          status: "open",
          created_at: 1_700_000_000,
          meta: { sender: { id: 10, identifier: "user-1" } },
        }] : [] } });
      }
      if (url.pathname.endsWith("/messages")) {
        return Response.json({ payload: url.searchParams.get("after") === "0" ? [{
          id: 30,
          conversation_id: 20,
          attachments: [{ id: 40, file_name: "proof.txt", data_url: "https://files.example.test/proof.txt" }],
        }] : [] });
      }
      return Response.json([]);
    };

    const result = await exportChatwoot({
      baseUrl: "https://support.example.test",
      accountId: 7,
      outputDirectory: output,
      accessToken: "test-token",
      attachmentHosts: ["files.example.test"],
      fetchImpl,
    });
    assert.deepEqual(result.manifest.counts, {
      contacts: 1,
      conversations: 1,
      messages: 1,
      attachments: 1,
    });
    assert.equal(result.manifest.artifacts.every((artifact) => /^[a-f0-9]{64}$/u.test(artifact.sha256)), true);
    const message = JSON.parse((await readFile(join(output, "messages.ndjson"), "utf8")).trim());
    assert.equal(message.message.attachments[0]._opengrow_export.bytes, 18);
    assert.equal(
      requests.find((request) => request.url.startsWith("https://files.example.test"))?.headers.api_access_token,
      undefined,
    );
    await loadChatwootBundle(output);
    const { target } = await loadTarget("vocostar");
    const cutover = await buildChatwootCutover({
      bundleDirectory: output,
      target,
      environment: "production",
      projectId: 12,
    });
    assert.equal(cutover.transformation.ready, true);
    const rendered = await renderArtifacts(
      cutover,
      join(parent, "rendered"),
      "vocostar",
      "production",
    );
    assert.equal(rendered.plan.uploads.count, 1);
    assert.match(await readFile(join(rendered.destination, "support-import.sql"), "utf8"), /support_message_attachments/u);
    const verified = await loadRenderedChatwoot(rendered.destination);
    assert.equal(verified.uploads.objects[0].source_path, join(output, "attachments/20/30/0-proof.txt"));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("Chatwoot export refuses repository destinations and stops duplicate pagination", async () => {
  assert.throws(
    () => assertProtectedDirectory(resolve(root, "private-chatwoot-export")),
    /inside the Git repository/u,
  );
  let calls = 0;
  const rows = await paged(
    async () => {
      calls += 1;
      return [{ id: 1 }];
    },
    (value) => value,
  );
  assert.deepEqual(rows, [{ id: 1 }]);
  assert.equal(calls, 2);
});

test("Chatwoot export retries transient network failures", async () => {
  const parent = await mkdtemp(join(tmpdir(), "superboard-chatwoot-retry-"));
  let calls = 0;
  try {
    await exportChatwoot({
      baseUrl: "https://support.example.test",
      accountId: 7,
      outputDirectory: join(parent, "snapshot"),
      accessToken: "test-token",
      fetchImpl: async (input) => {
        calls += 1;
        if (calls === 1) throw new Error("temporary network error");
        const url = new URL(input);
        if (url.pathname.endsWith("/contacts") || url.pathname.endsWith("/conversations")) {
          return Response.json({ payload: [] });
        }
        return Response.json([]);
      },
    });
    assert.ok(calls > 1);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("Chatwoot export origin is owned by the application target", async () => {
  const { target } = await loadTarget("vocostar");
  assert.equal(chatwootOriginFromTarget(target), "https://chat.vocostar.com");
  assert.throws(
    () => chatwootOriginFromTarget({ publicSurfaceMonitors: [] }),
    /exactly one legacy-chatwoot/u,
  );
});
