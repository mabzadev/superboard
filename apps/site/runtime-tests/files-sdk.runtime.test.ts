import { env, createExecutionContext } from "cloudflare:test";
import { expect, test, vi } from "vitest";

import filesWorker from "../../../workers/files/src/index.js";
import { issueAccessToken, publicJwks } from "../../../workers/identity/src/crypto.js";

test("Files stores SDK uploads with known or streamed length in real R2 and refuses missing storage at health check", async () => {
	const bindings = env as unknown as {
		HEALTH_IDENTITY_KEYSET: string;
		HEALTH_FILES_DB: D1Database;
		HEALTH_FILES_R2: R2Bucket;
		HEALTH_MIGRATIONS_JSON: string;
	};
	const issuer = {
		IDENTITY_KEYSET: bindings.HEALTH_IDENTITY_KEYSET,
		APPLICATION_AUDIENCE: "files.runtime",
		OPENGROW_IDENTITY_ISSUER: "https://external-idp.test",
		ACCESS_TOKEN_TTL: "900",
	};
	const token = await issueAccessToken(issuer as never, 81, "files-sdk-owner", "external-session");
	const external = vi.spyOn(globalThis, "fetch").mockImplementation(async (request) => {
		expect(request instanceof Request ? request.url : String(request)).toBe(
			"https://external-idp.test/jwks",
		);
		return Response.json(publicJwks(issuer as never));
	});
	const migrations = JSON.parse(bindings.HEALTH_MIGRATIONS_JSON) as Record<
		string,
		Array<{ name: string }>
	>;
	const workerEnv = {
		DB: bindings.HEALTH_FILES_DB,
		FILES: bindings.HEALTH_FILES_R2,
		ENVIRONMENT: "local",
		D1_EXPECTED_MIGRATION: migrations.files!.at(-1)!.name,
		AUTH_GATEWAY_JWKS_URL: "https://external-idp.test/jwks",
		AUTH_GATEWAY_ISSUER: issuer.OPENGROW_IDENTITY_ISSUER,
		APPLICATION_AUDIENCE: issuer.APPLICATION_AUDIENCE,
		MAX_FILE_BYTES: "1024",
		ALLOWED_FILE_CONTENT_TYPES_JSON: '["application/pdf"]',
	};
	try {
		await workerEnv.FILES.put("legacy/sdk-file", "legacy bytes");
		await workerEnv.DB.prepare(
			"INSERT INTO application_files(id,user_id,object_key,filename,content_type,byte_size) VALUES ('018fc174-7c54-4d9b-8bfc-5fd23bc2b067','files-sdk-owner','legacy/sdk-file','legacy.pdf','application/pdf',12)",
		).run();
		const existing = await filesWorker.fetch!(
			new Request("https://files.test/v1/files", { headers: { Authorization: `Bearer ${token}` } }),
			workerEnv as never,
			createExecutionContext(),
		);
		expect(await existing.json()).toMatchObject({
			files: [
				expect.objectContaining({
					id: "018fc174-7c54-4d9b-8bfc-5fd23bc2b067",
					filename: "legacy.pdf",
				}),
			],
		});
		const retained = await filesWorker.fetch!(
			new Request("https://files.test/v1/files/018fc174-7c54-4d9b-8bfc-5fd23bc2b067/content", {
				headers: { Authorization: `Bearer ${token}` },
			}),
			workerEnv as never,
			createExecutionContext(),
		);
		expect(retained.status).toBe(200);
		expect(retained.headers.has("content-range")).toBe(false);
		expect(await retained.text()).toBe("legacy bytes");
		const partial = await filesWorker.fetch!(
			new Request("https://files.test/v1/files/018fc174-7c54-4d9b-8bfc-5fd23bc2b067/content", {
				headers: { Authorization: `Bearer ${token}`, Range: "bytes=0-5" },
			}),
			workerEnv as never,
			createExecutionContext(),
		);
		expect(partial.status).toBe(206);
		expect(partial.headers.get("content-range")).toBe("bytes 0-5/12");
		expect(await partial.text()).toBe("legacy");
		const bytes = new TextEncoder().encode("%PDF-1.4 retained bytes");
		for (const knownLength of [true, false]) {
			const headers = new Headers({
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/pdf",
				"X-Filename": "document.pdf",
			});
			if (knownLength) headers.set("Content-Length", String(bytes.byteLength));
			const uploaded = await filesWorker.fetch!(
				new Request("https://files.test/v1/files", {
					method: "POST",
					headers,
					body: new ReadableStream({
						start(controller) {
							controller.enqueue(bytes);
							controller.close();
						},
					}),
				}),
				workerEnv as never,
				createExecutionContext(),
			);
			expect(uploaded.status, await uploaded.clone().text()).toBe(201);
			const payload = (await uploaded.json()) as { file: { id: string; byte_size: number } };
			expect(payload.file.byte_size).toBe(bytes.byteLength);
			const record = await workerEnv.DB.prepare(
				"SELECT object_key FROM application_files WHERE id=?",
			)
				.bind(payload.file.id)
				.first<{ object_key: string }>();
			expect(await (await workerEnv.FILES.get(record!.object_key))!.text()).toBe(
				new TextDecoder().decode(bytes),
			);
		}
		const unavailable = await filesWorker.fetch!(
			new Request("https://files.test/health"),
			{ ...workerEnv, FILES: undefined } as never,
			createExecutionContext(),
		);
		expect(unavailable.status).toBe(503);
	} finally {
		external.mockRestore();
	}
});
