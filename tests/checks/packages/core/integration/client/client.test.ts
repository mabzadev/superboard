import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { EmDashClient, EmDashApiError } from "../../../../../../packages/core/src/client/index.js";
import type { TestServerContext } from "../server.js";
import { assertNodeVersion, createTestServer } from "../server.js";

const PORT = 4399;

describe("EmDashClient Integration", () => {
	let ctx: TestServerContext;

	beforeAll(async () => {
		assertNodeVersion();
		ctx = await createTestServer({ port: PORT });
	});

	afterAll(async () => {
		await ctx?.cleanup();
	});

	it("fetches the manifest", async () => {
		const manifest = await ctx.client.manifest();
		expect(manifest.version).toBeDefined();
		expect(typeof manifest.collections).toBe("object");
	});

	it("lists collections", async () => {
		const collections = await ctx.client.collections();
		expect(Array.isArray(collections)).toBe(true);
		const slugs = collections.map((c: { slug: string }) => c.slug);
		expect(slugs).toContain("posts");
		expect(slugs).toContain("pages");
	});

	it("lists seeded content", async () => {
		const posts = await ctx.client.list("posts");
		expect(posts.items.length).toBeGreaterThanOrEqual(2);

		const titles = posts.items.map((p: { data: Record<string, unknown> }) => p.data.title);
		expect(titles).toContain("First Post");
		expect(titles).toContain("Second Post");
	});

	it("creates, reads, updates, and deletes content", async () => {
		const item = await ctx.client.create("posts", {
			data: { title: "E2E Article", body: "Hello **e2e**", excerpt: "Testing" },
			slug: "e2e-article",
		});
		expect(item.id).toBeDefined();
		expect(item.slug).toBe("e2e-article");

		const fetched = await ctx.client.get("posts", item.id);
		expect(fetched.data.title).toBe("E2E Article");
		expect(typeof fetched.data.body).toBe("string");
		expect(fetched._rev).toBeDefined();

		const updated = await ctx.client.update("posts", item.id, {
			data: { title: "Updated E2E Article" },
			_rev: fetched._rev,
		});
		expect(updated.data.title).toBe("Updated E2E Article");

		await ctx.client.publish("posts", item.id);
		await ctx.client.unpublish("posts", item.id);

		await ctx.client.delete("posts", item.id);
	});

	it("blind update succeeds without _rev", async () => {
		const item = await ctx.client.create("posts", {
			data: { title: "Blind Update Test" },
		});

		const freshClient = new EmDashClient({
			baseUrl: ctx.baseUrl,
			devBypass: true,
		});

		const updated = await freshClient.update("posts", item.id, {
			data: { title: "Blind Write OK" },
		});
		expect(updated.data.title).toBe("Blind Write OK");

		await ctx.client.delete("posts", item.id);
	});

	it("returns Portable Text arrays in raw mode", async () => {
		const item = await ctx.client.create("posts", {
			data: { title: "Raw Test", body: "Some **bold** text" },
		});

		const normal = await ctx.client.get("posts", item.id);
		expect(typeof normal.data.body).toBe("string");

		const raw = await ctx.client.get("posts", item.id, { raw: true });
		expect(Array.isArray(raw.data.body)).toBe(true);

		await ctx.client.delete("posts", item.id);
	});

	it("authenticates with PAT token", async () => {
		const res = await fetch(`${ctx.baseUrl}/_emdash/api/content/posts`, {
			headers: { Authorization: `Bearer ${ctx.token}` },
		});
		expect(res.ok).toBe(true);
		const json = (await res.json()) as { data: { items: unknown[] } };
		expect(Array.isArray(json.data.items)).toBe(true);
	});

	async function fetchHtml(path: string): Promise<string> {
		const res = await fetch(`${ctx.baseUrl}${path}`);
		return res.text();
	}

	it("renders seeded posts on the index page", async () => {
		const html = await fetchHtml("/");
		expect(html).toContain("First Post");
		expect(html).toContain("Second Post");
		expect(html).not.toContain("Draft Post");
	});

	it("renders a single post by slug", async () => {
		const html = await fetchHtml("/posts/first-post");
		expect(html).toContain('<h1 id="title">First Post</h1>');
		expect(html).toContain("The very first post");
	});

	it("returns 404 for a nonexistent slug", async () => {
		const res = await fetch(`${ctx.baseUrl}/posts/does-not-exist`);
		expect(res.status).toBe(404);
	});

	it("reflects API edits in rendered output", async () => {
		const item = await ctx.client.create("posts", {
			data: { title: "Render Test Post", excerpt: "Check the HTML" },
			slug: "render-test",
		});
		await ctx.client.publish("posts", item.id);

		const indexHtml = await fetchHtml("/");
		expect(indexHtml).toContain("Render Test Post");

		const postHtml = await fetchHtml("/posts/render-test");
		expect(postHtml).toContain("Render Test Post");
		expect(postHtml).toContain("Check the HTML");

		const current = await ctx.client.get("posts", item.id);
		await ctx.client.update("posts", item.id, {
			data: { title: "Edited Render Test" },
			_rev: current._rev,
		});

		const updatedHtml = await fetchHtml("/posts/render-test");
		expect(updatedHtml).toContain("Edited Render Test");
		expect(updatedHtml).not.toContain("Render Test Post");

		await ctx.client.unpublish("posts", item.id);
		const afterUnpublish = await fetchHtml("/");
		expect(afterUnpublish).not.toContain("Edited Render Test");

		await ctx.client.delete("posts", item.id);
	});

	it("creates and deletes collections", async () => {
		const col = await ctx.client.createCollection({
			slug: "e2e_temp",
			label: "Temp",
		});
		expect(col.slug).toBe("e2e_temp");

		const titleField = await ctx.client.createField("e2e_temp", {
			slug: "title",
			type: "string",
			label: "Title",
		});
		expect(titleField.slug).toBe("title");

		await ctx.client.deleteCollection("e2e_temp");

		const collections = await ctx.client.collections();
		const slugs = collections.map((c: { slug: string }) => c.slug);
		expect(slugs).not.toContain("e2e_temp");
	});

	it("uploads, gets, lists, and deletes media", async () => {
		const pngBytes = new Uint8Array([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
			0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
			0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8,
			0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
			0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
		]);

		const uploaded = await ctx.client.mediaUpload(pngBytes, "test-pixel.png", {
			alt: "A test pixel",
		});
		expect(uploaded.id).toBeDefined();
		expect(uploaded.filename).toBe("test-pixel.png");
		expect(uploaded.mimeType).toBe("image/png");

		const fetched = await ctx.client.mediaGet(uploaded.id);
		expect(fetched.id).toBe(uploaded.id);
		expect(fetched.filename).toBe("test-pixel.png");

		const list = await ctx.client.mediaList();
		expect(list.items.length).toBeGreaterThanOrEqual(1);
		const ids = list.items.map((m: { id: string }) => m.id);
		expect(ids).toContain(uploaded.id);

		const folder = await ctx.client.mediaFolderCreate("Client photos");
		const assigned = await ctx.client.mediaSetFolder(uploaded.id, folder.id);
		expect(assigned.folderId).toBe(folder.id);
		const folderList = await ctx.client.mediaFolderList();
		expect(folderList.items).toContainEqual(folder);
		const folderMedia = await ctx.client.mediaList({ folderId: folder.id });
		expect(folderMedia.items.map((item) => item.id)).toContain(uploaded.id);
		expect(await ctx.client.mediaFolderUpdate(folder.id, "Renamed client photos")).toMatchObject({
			id: folder.id,
			name: "Renamed client photos",
		});
		await ctx.client.mediaFolderDelete(folder.id);
		expect((await ctx.client.mediaGet(uploaded.id)).folderId).toBeNull();

		await ctx.client.mediaDelete(uploaded.id);

		await expect(ctx.client.mediaGet(uploaded.id)).rejects.toThrow();
	});

	it("returns 409 on _rev conflict", async () => {
		const item = await ctx.client.create("posts", {
			data: { title: "Conflict Test" },
		});

		const clientA = new EmDashClient({ baseUrl: ctx.baseUrl, token: ctx.token });
		const clientB = new EmDashClient({ baseUrl: ctx.baseUrl, token: ctx.token });

		const fetchedA = await clientA.get("posts", item.id);
		const fetchedB = await clientB.get("posts", item.id);

		await clientA.update("posts", item.id, {
			data: { title: "A wins" },
			_rev: fetchedA._rev,
		});

		try {
			await clientB.update("posts", item.id, {
				data: { title: "B loses" },
				_rev: fetchedB._rev,
			});
			expect.fail("Should have thrown a conflict error");
		} catch (error) {
			expect(error).toBeInstanceOf(EmDashApiError);
			const apiErr = error as EmDashApiError;
			expect(apiErr.status).toBe(409);
			expect(apiErr.code).toBe("CONFLICT");
		}

		await ctx.client.delete("posts", item.id);
	});

	it("schedules and restores content", async () => {
		const item = await ctx.client.create("posts", {
			data: { title: "Schedule Test" },
		});

		await ctx.client.schedule("posts", item.id, { at: "2027-06-01T09:00:00Z" });

		const fetched = await ctx.client.get("posts", item.id);
		expect(fetched.scheduledAt).toBe("2027-06-01T09:00:00Z");

		await ctx.client.delete("posts", item.id);
		await ctx.client.restore("posts", item.id);

		const restored = await ctx.client.get("posts", item.id);
		expect(restored.status).toBe("scheduled");

		await ctx.client.delete("posts", item.id);
	});

	it("listAll iterates through paginated results", async () => {
		const ids: string[] = [];
		for (let i = 0; i < 5; i++) {
			const item = await ctx.client.create("posts", {
				data: { title: `Paginate ${i}` },
			});
			ids.push(item.id);
		}

		const all: { id: string }[] = [];
		for await (const item of ctx.client.listAll("posts", { limit: 2 })) {
			all.push(item);
		}

		expect(all.length).toBeGreaterThanOrEqual(5);

		const resultIds = all.map((a) => a.id);
		for (const id of ids) {
			expect(resultIds).toContain(id);
		}

		for (const id of ids) {
			await ctx.client.delete("posts", id);
		}
	});

	it("throws EmDashApiError on 404", async () => {
		try {
			await ctx.client.get("posts", "nonexistent-id-12345");
			expect.fail("Should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(EmDashApiError);
			const apiErr = error as EmDashApiError;
			expect(apiErr.status).toBe(404);
			expect(apiErr.code).toBe("NOT_FOUND");
		}
	});

	it("throws on unauthorized request (no token)", async () => {
		const noAuthClient = new EmDashClient({
			baseUrl: ctx.baseUrl,
		});

		try {
			await noAuthClient.collections();
			expect.fail("Should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(EmDashApiError);
			expect((error as EmDashApiError).status).toBe(401);
		}
	});
});
