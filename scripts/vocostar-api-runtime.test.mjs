import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { build } from "esbuild";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Miniflare } from "miniflare";

import { signSiteOperatorRequest } from "../packages/contracts/src/site-operator.ts";

test("Vocostar API preserves WebSockets and authenticates SDK scope without granting callback privileges", async (t) => {
	const bundle = await build({
		stdin: {
			contents: `import { app } from "./workers/api/src/index.ts";
import { Hono } from "hono";
import customSdk from "./workers/api/src/routes/custom-sdk.ts";
const sdk = new Hono();
sdk.use("*", async (c, next) => { c.set("projectId", 11); c.set("instanceId", 10); await next(); });
sdk.route("/", customSdk);
export default { fetch(request, env, ctx) {
 const url = new URL(request.url);
 if (url.hostname === "sdk.example") return sdk.fetch(request, env, ctx);
 if (url.hostname === "disabled.example") env = { ...env, SUPERBOARD_PLUGIN_LIFECYCLE: "required", SUPERBOARD_INSTANCE_ID: "fixture", SITE_OPERATOR_BRIDGE_TOKEN: "fixture" };
 if (url.hostname === "other.example") env = { ...env, CUSTOM_WORKER_PLUGIN_ID: "supbrd-plugmod-custom-reference" };
 return app.fetch(request, env, ctx);
} };`,
			resolveDir: process.cwd(),
			sourcefile: "vocostar-api-fixture.ts",
		},
		bundle: true,
		write: false,
		format: "esm",
		platform: "node",
		conditions: ["workerd", "worker", "browser"],
		banner: {
			js: 'import { createRequire } from "node:module"; const require = createRequire("file:///worker.js");',
		},
		external: ["cloudflare:workers", "node:*"],
		logLevel: "silent",
	});
	const runtime = new Miniflare({
		workers: [
			{
				name: "api",
				modules: true,
				script: bundle.outputFiles[0].text,
				compatibilityDate: "2026-08-08",
				compatibilityFlags: ["nodejs_compat"],
				d1Databases: ["DB"],
				kvNamespaces: ["KV"],
				bindings: {
					SUPERBOARD_TARGET: "fixture",
					SITE_OPERATOR_BRIDGE_TOKEN: "site-secret",
					CUSTOM_WORKER_PLUGIN_ID: "supbrd-plugmod-vocostar",
					CUSTOM_WORKER_TOKEN: "custom-secret",
					AUTH_GATEWAY_ISSUER: "https://identity.example",
					AUTH_GATEWAY_AUDIENCE: "application",
					AUTH_GATEWAY_JWKS_URL: "https://identity.example/jwks",
					CORS_ORIGINS_JSON: '["https://console.example"]',
				},
				serviceBindings: { CUSTOM_WORKER: "custom", SITE_SERVICE: "authority" },
			},
			{
				name: "custom",
				modules: true,
				compatibilityDate: "2026-08-08",
				script: `export default { async fetch(request) {
const data = { path: new URL(request.url).pathname, headers: Object.fromEntries(request.headers), body: ["POST", "PUT"].includes(request.method) ? await request.json() : null };
if (request.headers.get("upgrade") === "websocket") {
 const pair = new WebSocketPair(); pair[1].accept(); pair[1].send(JSON.stringify(data));
 pair[1].addEventListener("message", () => pair[1].send("pong"));
 pair[1].addEventListener("close", () => pair[1].close());
 return new Response(null, { status: 101, webSocket: pair[0] });
}
return Response.json(data);
} };`,
			},
			{
				name: "authority",
				modules: true,
				compatibilityDate: "2026-08-08",
				script:
					'export default { fetch() { return Response.json({ error: { code: "PLUGIN_NOT_ACTIVE" } }, { status: 409 }); } };',
			},
		],
	});
	const sockets = [];
	const readSocket = async (response) => {
		assert.equal(response.status, 101);
		const socket = response.webSocket;
		assert.ok(socket);
		sockets.push(socket);
		const message = new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("WebSocket snapshot timed out")), 3000);
			socket.addEventListener(
				"message",
				(event) => {
					clearTimeout(timer);
					resolve(JSON.parse(event.data));
				},
				{ once: true },
			);
		});
		socket.accept();
		return message;
	};
	try {
		await t.test(
			"callbacks drain when plugin admission is closed and client scope headers are removed",
			async () => {
				const response = await runtime.dispatchFetch(
					"https://disabled.example/ws/medias/progress",
					{
						method: "POST",
						body: JSON.stringify({ user_id: "legacy", media_id: "media", progress: 0.5 }),
						headers: {
							"content-type": "application/json",
							"x-vocostar-internal-token": "callback-secret",
							"x-custom-worker-token": "forged",
							"x-custom-worker-project": "another-project",
							"x-custom-worker-subject": "victim",
							"x-user-id": "victim",
							cookie: "operator=secret",
						},
					},
				);
				assert.equal(response.status, 200);
				const body = await response.json();
				assert.equal(body.headers["x-vocostar-internal-token"], "callback-secret");
				assert.equal(body.body.user_id, "legacy");
				for (const name of [
					"x-custom-worker-token",
					"x-custom-worker-project",
					"x-custom-worker-subject",
					"x-user-id",
					"cookie",
				])
					assert.equal(body.headers[name], undefined);
			},
		);
		await t.test("legacy WebSocket survives the actual API CORS middleware", async () => {
			const data = await readSocket(
				await runtime.dispatchFetch("https://api.example/ws/vocals?token=legacy", {
					headers: {
						Upgrade: "websocket",
						Origin: "https://console.example",
						"x-user-id": "forged",
					},
				}),
			);
			assert.equal(data.path, "/ws/vocals");
			assert.equal(data.headers["x-user-id"], undefined);
		});
		await t.test(
			"disabled plugins reject new sockets and other applications expose no legacy callbacks",
			async () => {
				const denied = await runtime.dispatchFetch("https://disabled.example/ws/vocals", {
					headers: { Upgrade: "websocket" },
				});
				assert.equal(denied.status, 404);
				const other = await runtime.dispatchFetch("https://other.example/internal/notify", {
					method: "POST",
					body: "{}",
				});
				assert.equal(other.status, 404);
			},
		);
		await t.test(
			"SDK socket uses the verified identity and project from a real D1 store",
			async () => {
				const db = await runtime.getD1Database("DB");
				await db.exec(
					"CREATE TABLE projects(id INTEGER, instance_id INTEGER, is_test INTEGER, test INTEGER); CREATE TABLE billing_oidc_configs(project_id TEXT, issuer TEXT, audience TEXT, jwks_uri TEXT, enabled INTEGER); INSERT INTO projects VALUES(11,10,0,0);",
				);
				const { publicKey, privateKey } = await generateKeyPair("ES256");
				const jwk = { ...(await exportJWK(publicKey)), kid: "fixture", alg: "ES256", use: "sig" };
				const kv = await runtime.getKVNamespace("KV");
				await kv.put(
					`billing:jwks:${createHash("sha256").update("https://identity.example/jwks").digest("hex")}`,
					JSON.stringify({ keys: [jwk] }),
				);
				const token = await new SignJWT({})
					.setProtectedHeader({ alg: "ES256", kid: "fixture" })
					.setIssuer("https://identity.example")
					.setAudience("application")
					.setSubject("user-42")
					.setExpirationTime("5m")
					.sign(privateKey);
				const data = await readSocket(
					await runtime.dispatchFetch("https://sdk.example/ws/medias", {
						headers: {
							Upgrade: "websocket",
							Authorization: `Bearer ${token}`,
							"x-custom-worker-project": "evil",
							"x-custom-worker-subject": "victim",
						},
					}),
				);
				assert.equal(data.path, "/internal/v1/runtime/ws/medias");
				assert.equal(data.headers["x-custom-worker-project"], "10-prod");
				assert.equal(data.headers["x-custom-worker-subject"], "user-42");
				assert.equal(data.headers["x-custom-worker-token"], "custom-secret");
				const invalid = await runtime.dispatchFetch("https://sdk.example/ws/medias", {
					headers: { Upgrade: "websocket", Authorization: "Bearer invalid" },
				});
				assert.equal(invalid.status, 401);
			},
		);
		await t.test(
			"identity registration requires an administrator and derives project scope from the authorized route",
			async () => {
				const db = await runtime.getD1Database("DB");
				await db.exec(
					"CREATE TABLE site_operator_instances(instance_slug TEXT, instance_id INTEGER); INSERT INTO site_operator_instances VALUES('fixture',10);",
				);
				const register = async (role, projectRef = "10-prod") => {
					const request = new Request(
						`https://api.example/api/v1/plugins/vocostar/projects/${projectRef}/runtime-identities`,
						{ method: "PUT" },
					);
					const headers = await signSiteOperatorRequest(
						request,
						{ operator_id: "operator", instance_id: "fixture", role },
						"site-secret",
					);
					headers.set("content-type", "application/json");
					return runtime.dispatchFetch(request.url, {
						method: "PUT",
						headers,
						body: JSON.stringify({
							legacyUserId: "legacy",
							subject: "oidc:subject",
							projectRef: "forged",
						}),
					});
				};
				assert.equal((await register(40)).status, 403);
				assert.equal((await register(50, "99-prod")).status, 403);
				const response = await register(50);
				assert.equal(response.status, 200);
				const result = await response.json();
				assert.equal(result.path, "/internal/v1/runtime/identities");
				assert.deepEqual(result.body, {
					legacyUserId: "legacy",
					subject: "oidc:subject",
					projectRef: "10-prod",
				});
			},
		);
	} finally {
		for (const socket of sockets) socket.close(1000);
		await runtime.dispose();
	}
});
