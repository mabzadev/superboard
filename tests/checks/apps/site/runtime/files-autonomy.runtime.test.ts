import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";

import files from "../../../../../packages/plugins/supbrd-plug-data/worker/src/index.js";

const bindings = env as typeof env & { HEALTH_FILES_DB: D1Database; HEALTH_FILES_R2: R2Bucket };
const secret = "files-autonomy-secret";
const runtime = {
	DB: bindings.HEALTH_FILES_DB,
	FILES: bindings.HEALTH_FILES_R2,
	FILES_INTERNAL_TOKEN: secret,
	MAX_FILE_BYTES: "1024",
	ALLOWED_FILE_CONTENT_TYPES_JSON: '["text/plain"]',
} as Parameters<typeof files.fetch>[1];
async function call(
	method: string,
	path: string,
	body?: unknown,
	projectId = 1,
	key = crypto.randomUUID(),
) {
	const headers = await createProjectContextHeaders(
		{
			module: "files",
			projectId,
			instanceId: projectId,
			projectRef: `${projectId}-prod`,
			environment: "production",
			actorId: 0,
			operatorId: "operator-files",
			role: "owner",
			method,
			pathname: path,
			requestId: crypto.randomUUID(),
			issuedAt: Math.floor(Date.now() / 1000),
		},
		secret,
	);
	headers.set("Idempotency-Key", key);
	if (body !== undefined)
		headers.set("Content-Type", typeof body === "string" ? "text/plain" : "application/json");
	return files.fetch(
		new Request(`https://files.internal${path}`, {
			method,
			headers,
			...(body !== undefined
				? { body: typeof body === "string" ? body : JSON.stringify(body) }
				: {}),
		}),
		runtime,
	);
}

test("Files completes a real R2 upload, preserves bytes and scopes metadata and deletion", async () => {
	const created = await call(
		"POST",
		"/internal/v1/operator/upload-tickets",
		{ filename: "document.txt", content_type: "text/plain", byte_size: 5 },
		1,
		"ticket-idempotence",
	);
	expect(created.status, await created.clone().text()).toBe(201);
	const ticket = (await created.json()).data;
	expect(
		await (
			await call(
				"POST",
				"/internal/v1/operator/upload-tickets",
				{ filename: "document.txt", content_type: "text/plain", byte_size: 5 },
				1,
				"ticket-idempotence",
			)
		).json(),
	).toMatchObject({ data: { id: ticket.id } });
	expect(
		(await call("POST", `/internal/v1/operator/upload-tickets/${ticket.id}/complete`, {})).status,
	).toBe(409);
	expect(
		(await call("PUT", `/internal/v1/operator/upload-tickets/${ticket.id}/content`, "hello"))
			.status,
	).toBe(200);
	const completed = await call(
		"POST",
		`/internal/v1/operator/upload-tickets/${ticket.id}/complete`,
		{},
	);
	expect(completed.status, await completed.clone().text()).toBe(201);
	expect(
		await (await call("GET", `/internal/v1/operator/objects/${ticket.id}/content`)).text(),
	).toBe("hello");
	expect(
		(await call("GET", `/internal/v1/operator/objects/${ticket.id}/content`, undefined, 2)).status,
	).toBe(404);
	expect(await (await call("GET", "/internal/v1/operator/usage")).json()).toMatchObject({
		data: { files: 1, bytes: 5 },
	});
	expect((await call("DELETE", `/internal/v1/operator/objects/${ticket.id}`)).status).toBe(200);
	expect((await call("GET", `/internal/v1/operator/objects/${ticket.id}/content`)).status).toBe(
		404,
	);
	expect(await bindings.HEALTH_FILES_R2.head(ticket.object_key)).not.toBeNull();
});

test("Files returns actionable input errors and allows retry after an interrupted upload", async () => {
	for (const [body, status, code] of [
		[{ filename: "", content_type: "text/plain", byte_size: 5 }, 422, "filename_invalid"],
		[{ filename: "file", content_type: "invalid", byte_size: 5 }, 422, "content_type_invalid"],
		[
			{ filename: "file", content_type: "image/png", byte_size: 5 },
			415,
			"content_type_not_allowed",
		],
		["{", 400, "json_invalid"],
	] as const) {
		const response = await call("POST", "/internal/v1/operator/upload-tickets", body, 3);
		expect(response.status, await response.clone().text()).toBe(status);
		expect(await response.json()).toMatchObject({ error: { code } });
	}
	const ticket = (
		await (
			await call(
				"POST",
				"/internal/v1/operator/upload-tickets",
				{
					filename: "retry.txt",
					content_type: "text/plain",
					byte_size: 5,
				},
				3,
			)
		).json()
	).data;
	const path = `/internal/v1/operator/upload-tickets/${ticket.id}`;
	const incomplete = await call("PUT", `${path}/content`, "hi", 3);
	expect(incomplete.status, await incomplete.clone().text()).toBe(422);
	expect(await incomplete.json()).toMatchObject({ error: { code: "FILE_SIZE_MISMATCH" } });
	expect(await bindings.HEALTH_FILES_R2.head(ticket.object_key)).toBeNull();
	expect((await call("PUT", `${path}/content`, "hello", 3)).status).toBe(200);
	expect((await call("POST", `${path}/complete`, {}, 3)).status).toBe(201);
	expect(
		await (
			await call("GET", `/internal/v1/operator/objects/${ticket.id}/content`, undefined, 3)
		).text(),
	).toBe("hello");
});

test("Files collects expired uploads abandoned during a Worker restart and preserves other projects", async () => {
	const created = await call(
		"POST",
		"/internal/v1/operator/upload-tickets",
		{
			filename: "abandoned.txt",
			content_type: "text/plain",
			byte_size: 5,
		},
		4,
	);
	const ticket = (await created.json()).data;
	await bindings.HEALTH_FILES_R2.put(ticket.object_key, "hello");
	await bindings.HEALTH_FILES_DB.prepare(
		"UPDATE operator_file_uploads SET state='uploading',expires_at='2000-01-01' WHERE id=?",
	)
		.bind(ticket.id)
		.run();
	expect(
		await (await call("POST", "/internal/v1/operator/collect-garbage", {}, 5)).json(),
	).toMatchObject({ data: { collected: 0 } });
	expect(await bindings.HEALTH_FILES_R2.head(ticket.object_key)).not.toBeNull();
	expect(
		await (await call("POST", "/internal/v1/operator/collect-garbage", {}, 4)).json(),
	).toMatchObject({ data: { collected: 1 } });
	expect(await bindings.HEALTH_FILES_R2.head(ticket.object_key)).toBeNull();
	expect(
		(await call("PUT", `/internal/v1/operator/upload-tickets/${ticket.id}/content`, "hello", 4))
			.status,
	).toBe(404);
});
