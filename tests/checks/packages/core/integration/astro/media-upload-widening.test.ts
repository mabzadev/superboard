import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as postMedia } from "../../../../../../packages/core/src/astro/routes/api/media.js";
import { POST as postUploadUrl } from "../../../../../../packages/core/src/astro/routes/api/media/upload-url.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { SchemaRegistry } from "../../../../../../packages/core/src/schema/registry.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

interface StorageEntry {
	body: Uint8Array;
	contentType: string;
}

function createMemoryStorage(): {
	store: Map<string, StorageEntry>;
	storage: {
		upload: (opts: { key: string; body: Uint8Array; contentType: string }) => Promise<void>;
		download: (key: string) => Promise<Uint8Array | null>;
		delete: (key: string) => Promise<void>;
		exists: (key: string) => Promise<boolean>;
		list: () => Promise<string[]>;
		getSignedUploadUrl: () => Promise<string>;
	};
} {
	const store = new Map<string, StorageEntry>();
	const storage = {
		async upload(opts: { key: string; body: Uint8Array; contentType: string }) {
			store.set(opts.key, { body: opts.body, contentType: opts.contentType });
		},
		async download(key: string) {
			return store.get(key)?.body ?? null;
		},
		async delete(key: string) {
			store.delete(key);
		},
		async exists(key: string) {
			return store.has(key);
		},
		async list() {
			return [...store.keys()];
		},
		async getSignedUploadUrl() {
			return "http://localhost/signed";
		},
	};
	return { store, storage };
}

function buildContext(opts: {
	db: Kysely<Database>;
	request: Request;
	storage: ReturnType<typeof createMemoryStorage>["storage"];
}): APIContext {
	return {
		params: {},
		url: new URL(opts.request.url),
		request: opts.request,
		locals: {
			emdash: {
				db: opts.db,
				config: {},
				storage: opts.storage,
				handleMediaList: async () => ({ success: true as const, data: { items: [] } }),
				handleMediaCreate: async (input: {
					filename: string;
					mimeType: string;
					size: number;
					storageKey: string;
					contentHash: string;
					authorId?: string;
					width?: number;
					height?: number;
					blurhash?: string;
					dominantColor?: string;
				}) => ({
					success: true as const,
					data: {
						item: {
							id: "test-id",
							filename: input.filename,
							mimeType: input.mimeType,
							size: input.size,
							storageKey: input.storageKey,
							contentHash: input.contentHash,
							width: input.width ?? null,
							height: input.height ?? null,
							blurhash: input.blurhash ?? null,
							dominantColor: input.dominantColor ?? null,
							authorId: input.authorId ?? null,
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
						},
					},
				}),
			},
			user: {
				id: "user-1",
				email: "test@example.com",
				name: "Test User",
				role: 50 as const,
			},
		},
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal stub for tests
	} as unknown as APIContext;
}

function buildUploadRequest(opts: { file: File; fieldId?: string }): Request {
	const formData = new FormData();
	formData.append("file", opts.file);
	if (opts.fieldId) {
		formData.append("fieldId", opts.fieldId);
	}
	return new Request("http://localhost/_emdash/api/media", {
		method: "POST",
		headers: {
			"X-EmDash-Request": "1",
		},
		body: formData,
	});
}

describe("POST /media — upload widening via fieldId", () => {
	let db: Kysely<Database>;
	let zipFieldId: string;
	let imageFieldId: string;

	beforeEach(async () => {
		db = await setupTestDatabase();
		const registry = new SchemaRegistry(db);

		await registry.createCollection({
			slug: "article",
			label: "Articles",
			labelSingular: "Article",
		});

		const zipField = await registry.createField("article", {
			slug: "attachment",
			label: "Attachment",
			type: "file",
			validation: { allowedMimeTypes: ["application/zip"] },
		});
		zipFieldId = zipField.id;

		const imageField = await registry.createField("article", {
			slug: "thumbnail",
			label: "Thumbnail",
			type: "image",
			validation: { allowedMimeTypes: ["image/"] },
		});
		imageFieldId = imageField.id;
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("accepts a zip upload when fieldId resolves to a zip-allowing field", async () => {
		const { storage } = createMemoryStorage();
		const zipFile = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "archive.zip", {
			type: "application/zip",
		});

		const req = buildUploadRequest({ file: zipFile, fieldId: zipFieldId });
		const res = await postMedia(buildContext({ db, request: req, storage }));

		expect(res.status).toBe(201);
		const body = (await res.json()) as {
			data?: { item?: { mimeType: string } };
			error?: { code: string };
		};
		expect(body.error).toBeUndefined();
		expect(body.data?.item?.mimeType).toBe("application/zip");
	});

	it("rejects a zip upload when no fieldId is provided (global allowlist)", async () => {
		const { storage } = createMemoryStorage();
		const zipFile = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "archive.zip", {
			type: "application/zip",
		});

		const req = buildUploadRequest({ file: zipFile });
		const res = await postMedia(buildContext({ db, request: req, storage }));

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error?: { code: string } };
		expect(body.error?.code).toBe("INVALID_TYPE");
	});

	it("rejects a zip upload when fieldId points to an image-only field", async () => {
		const { storage } = createMemoryStorage();
		const zipFile = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "archive.zip", {
			type: "application/zip",
		});

		const req = buildUploadRequest({ file: zipFile, fieldId: imageFieldId });
		const res = await postMedia(buildContext({ db, request: req, storage }));

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error?: { code: string } };
		expect(body.error?.code).toBe("INVALID_TYPE");
	});
});

function createSignedUrlStorage(): ReturnType<typeof createMemoryStorage>["storage"] & {
	getSignedUploadUrl: (opts: {
		key: string;
		contentType: string;
		size: number;
		expiresIn: number;
	}) => Promise<{ url: string; method: "PUT"; headers: Record<string, string>; expiresAt: string }>;
} {
	const base = createMemoryStorage().storage;
	return {
		...base,
		async getSignedUploadUrl(opts: {
			key: string;
			contentType: string;
			size: number;
			expiresIn: number;
		}) {
			return {
				url: `http://storage.example.com/${opts.key}`,
				method: "PUT" as const,
				headers: { "Content-Type": opts.contentType },
				expiresAt: new Date(Date.now() + opts.expiresIn * 1000).toISOString(),
			};
		},
	};
}

function buildUploadUrlContext(opts: {
	db: Kysely<Database>;
	request: Request;
	storage: ReturnType<typeof createSignedUrlStorage>;
}): APIContext {
	return {
		params: {},
		url: new URL(opts.request.url),
		request: opts.request,
		locals: {
			emdash: {
				db: opts.db,
				config: {},
				storage: opts.storage,
			},
			user: {
				id: "user-1",
				email: "test@example.com",
				name: "Test User",
				role: 50 as const,
			},
		},
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal stub for tests
	} as unknown as APIContext;
}

function buildUploadUrlRequest(opts: {
	contentType: string;
	filename: string;
	size: number;
	fieldId?: string;
}): Request {
	const body: Record<string, unknown> = {
		filename: opts.filename,
		contentType: opts.contentType,
		size: opts.size,
	};
	if (opts.fieldId) {
		body.fieldId = opts.fieldId;
	}
	return new Request("http://localhost/_emdash/api/media/upload-url", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-EmDash-Request": "1",
		},
		body: JSON.stringify(body),
	});
}

describe("POST /media/upload-url — upload widening via fieldId", () => {
	let db: Kysely<Database>;
	let zipFieldId: string;
	let imageFieldId: string;

	beforeEach(async () => {
		db = await setupTestDatabase();
		const registry = new SchemaRegistry(db);

		await registry.createCollection({
			slug: "article",
			label: "Articles",
			labelSingular: "Article",
		});

		const zipField = await registry.createField("article", {
			slug: "attachment",
			label: "Attachment",
			type: "file",
			validation: { allowedMimeTypes: ["application/zip"] },
		});
		zipFieldId = zipField.id;

		const imageField = await registry.createField("article", {
			slug: "thumbnail",
			label: "Thumbnail",
			type: "image",
			validation: { allowedMimeTypes: ["image/"] },
		});
		imageFieldId = imageField.id;
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("accepts a zip when fieldId resolves to a zip-allowing field (upload-url route)", async () => {
		const storage = createSignedUrlStorage();
		const req = buildUploadUrlRequest({
			filename: "archive.zip",
			contentType: "application/zip",
			size: 1024,
			fieldId: zipFieldId,
		});
		const res = await postUploadUrl(buildUploadUrlContext({ db, request: req, storage }));

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data?: { uploadUrl?: string };
			error?: { code: string };
		};
		expect(body.error).toBeUndefined();
		expect(typeof body.data?.uploadUrl).toBe("string");
		expect(body.data?.uploadUrl).toMatch(/^http/);
	});

	it("rejects zip without fieldId (upload-url route)", async () => {
		const storage = createSignedUrlStorage();
		const req = buildUploadUrlRequest({
			filename: "archive.zip",
			contentType: "application/zip",
			size: 1024,
		});
		const res = await postUploadUrl(buildUploadUrlContext({ db, request: req, storage }));

		expect([400, 501]).toContain(res.status);
		if (res.status === 400) {
			const body = (await res.json()) as { error?: { code: string } };
			expect(body.error?.code).toBe("INVALID_TYPE");
		}
	});

	it("rejects zip when fieldId points to an image-only field (upload-url route)", async () => {
		const storage = createSignedUrlStorage();
		const req = buildUploadUrlRequest({
			filename: "archive.zip",
			contentType: "application/zip",
			size: 1024,
			fieldId: imageFieldId,
		});
		const res = await postUploadUrl(buildUploadUrlContext({ db, request: req, storage }));

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error?: { code: string } };
		expect(body.error?.code).toBe("INVALID_TYPE");
	});
});
