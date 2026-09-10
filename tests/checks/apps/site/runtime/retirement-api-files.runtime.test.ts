import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import {
	apiHeaders,
	apiCommand,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";
const plugin = "supbrd-plugmod-files";
const file = "retirement-api-files.runtime.test.ts";
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
	const bucket = (env as unknown as { HEALTH_FILES_R2: R2Bucket }).HEALTH_FILES_R2;
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
	expect(uploaded.status, await uploaded.clone().text()).toBe(200);
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
