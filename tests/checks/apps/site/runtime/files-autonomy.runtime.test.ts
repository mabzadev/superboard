import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { R2_FOLDERS, scopedR2Bucket } from "@superboard/contracts/r2";
import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";

import files from "../../../../../packages/plugins/superboard-data/worker/src/index.js";
import {
	apiCommand,
	apiHeaders,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";

const bindings = env as typeof env & { HEALTH_FILES_DB: D1Database; HEALTH_FILES_R2: R2Bucket };
const storedFiles = scopedR2Bucket(bindings.HEALTH_FILES_R2, R2_FOLDERS.files);
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
	expect(
		await bindings.HEALTH_FILES_R2.head(`${R2_FOLDERS.files}${ticket.object_key}`),
	).not.toBeNull();
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
	expect(await storedFiles.head(ticket.object_key)).toBeNull();
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
	await storedFiles.put(ticket.object_key, "hello");
	await bindings.HEALTH_FILES_DB.prepare(
		"UPDATE operator_file_uploads SET state='uploading',expires_at='2000-01-01' WHERE id=?",
	)
		.bind(ticket.id)
		.run();
	expect(
		await (await call("POST", "/internal/v1/operator/collect-garbage", {}, 5)).json(),
	).toMatchObject({ data: { collected: 0 } });
	expect(await storedFiles.head(ticket.object_key)).not.toBeNull();
	expect(
		await (await call("POST", "/internal/v1/operator/collect-garbage", {}, 4)).json(),
	).toMatchObject({ data: { collected: 1 } });
	expect(await storedFiles.head(ticket.object_key)).toBeNull();
	expect(
		(await call("PUT", `/internal/v1/operator/upload-tickets/${ticket.id}/content`, "hello", 4))
			.status,
	).toBe(404);
});

const plugin = "superboard-files";
const file = "files-autonomy.runtime.test.ts";
const bytes = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKXcAAAAASUVORK5CYII=",
	),
	(character) => character.charCodeAt(0),
);
test("canonical Files APIs persist metadata and bytes, return a working download, delete and collect abandoned uploads", async () => {
	const scope = await prepareApiPlugin(plugin);
	const base = `/api/v1/files/projects/${scope.production_project_ref}`;
	const db = pluginDatabase("files");
	const bucket = scopedR2Bucket(
		(env as unknown as { HEALTH_FILES_R2: R2Bucket }).HEALTH_FILES_R2,
		R2_FOLDERS.files,
	);
	const issue = () =>
		apiCommand(plugin, "create_upload_ticket", {
			method: "POST",
			path: `${base}/upload-tickets`,
			body: { filename: "proof.png", content_type: "image/png", byte_size: bytes.byteLength },
		});
	const ticket = await jsonResult<{ data: { id: string; upload_url: string } }>(await issue(), 201);
	const id = ticket.data.id;
	const storedTicket = await db
		.prepare("SELECT id,filename,byte_size,object_key,state FROM operator_file_uploads WHERE id=?")
		.bind(id)
		.first<{
			id: string;
			filename: string;
			byte_size: number;
			object_key: string;
			state: string;
		}>();
	expect(storedTicket).toMatchObject({
		id,
		filename: "proof.png",
		byte_size: bytes.byteLength,
		state: "created",
	});
	proveApi(plugin, "create_upload_ticket", "mutation", file, [id]);
	const uploaded = await SELF.fetch(`https://site.example${ticket.data.upload_url}`, {
		method: "PUT",
		headers: { ...apiHeaders, "Content-Type": "image/png", "Idempotency-Key": crypto.randomUUID() },
		body: bytes,
	});
	expect(uploaded.status).toBe(200);
	await jsonResult(
		await apiCommand(plugin, "complete_upload", {
			method: "POST",
			path: `${base}/upload-tickets/${id}/complete`,
			body: {},
		}),
		201,
	);
	const saved = await db
		.prepare("SELECT id,filename,byte_size,deleted_at FROM operator_files WHERE id=?")
		.bind(id)
		.first();
	expect(saved).toEqual({
		id,
		filename: "proof.png",
		byte_size: bytes.byteLength,
		deleted_at: null,
	});
	expect(await bucket.head(storedTicket!.object_key)).not.toBeNull();
	proveApi(plugin, "complete_upload", "mutation", file, [id]);
	const listed = await jsonResult<{ data: { items: Array<{ id: string; filename: string }> } }>(
		await apiRead(plugin, "objects", { method: "GET", path: `${base}/objects` }),
	);
	expect(listed.data.items).toContainEqual(expect.objectContaining({ id, filename: "proof.png" }));
	proveApi(plugin, "objects", "read", file, [id]);
	const metadata = await jsonResult<{ data: { id: string; filename: string; byte_size: number } }>(
		await apiRead(plugin, "object_metadata", { method: "GET", path: `${base}/objects/${id}` }),
	);
	expect(metadata.data).toMatchObject({ id, filename: "proof.png", byte_size: bytes.byteLength });
	proveApi(plugin, "object_metadata", "read", file, [id]);
	const download = await jsonResult<{ data: { download_url: string; authentication: string } }>(
		await apiRead(plugin, "download_ticket", {
			method: "GET",
			path: `${base}/objects/${id}/download-ticket`,
		}),
	);
	expect(download.data.authentication).toBe("operator-session");
	const content = await SELF.fetch(`https://site.example${download.data.download_url}`, {
		headers: apiHeaders,
	});
	expect(content.status).toBe(200);
	expect(new Uint8Array(await content.arrayBuffer())).toEqual(bytes);
	proveApi(plugin, "download_ticket", "read", file, [id]);
	const usage = await jsonResult<{ data: { files: number; bytes: number } }>(
		await apiRead(plugin, "storage_usage", { method: "GET", path: `${base}/usage` }),
	);
	expect(usage.data).toMatchObject({ files: 1, bytes: bytes.byteLength });
	proveApi(plugin, "storage_usage", "read", file, [id]);
	await jsonResult(
		await apiCommand(plugin, "delete_object", { method: "DELETE", path: `${base}/objects/${id}` }),
	);
	expect(
		(
			await db
				.prepare("SELECT deleted_at FROM operator_files WHERE id=?")
				.bind(id)
				.first<{ deleted_at: string }>()
		)?.deleted_at,
	).toBeTruthy();
	expect(
		(await apiRead(plugin, "object_metadata", { method: "GET", path: `${base}/objects/${id}` }))
			.status,
	).toBe(404);
	proveApi(plugin, "delete_object", "mutation", file, [id]);
	const abandoned = await jsonResult<{ data: { id: string } }>(await issue(), 201);
	const before = await db
		.prepare("SELECT object_key FROM operator_file_uploads WHERE id=?")
		.bind(abandoned.data.id)
		.first<{ object_key: string }>();
	await bucket.put(before!.object_key, bytes);
	await db
		.prepare(
			"UPDATE operator_file_uploads SET state='uploading',expires_at='2000-01-01' WHERE id=?",
		)
		.bind(abandoned.data.id)
		.run();
	const collected = await jsonResult<{ data: { collected: number } }>(
		await apiCommand(plugin, "collect_garbage", {
			method: "POST",
			path: `${base}/collect-garbage`,
			body: {},
		}),
	);
	expect(collected.data.collected).toBe(1);
	expect(await bucket.head(before!.object_key)).toBeNull();
	expect(
		await db
			.prepare("SELECT id FROM operator_file_uploads WHERE id=?")
			.bind(abandoned.data.id)
			.first(),
	).toBeNull();
	expect(await bucket.head(storedTicket!.object_key)).not.toBeNull();
	proveApi(plugin, "collect_garbage", "mutation", file, [abandoned.data.id]);
});
