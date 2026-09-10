import type { APIContext } from "astro";
import { SqliteDialect } from "kysely";
import { expect, test, vi } from "vitest";

import { dispatchContentPluginApi } from "../../../../apps/site/src/lib/content-plugin-api.js";
import { openNodeSqliteDatabase } from "../../../../packages/core/src/db/node-sqlite-compat.js";
import { EmDashRuntime } from "../../../../packages/core/src/emdash-runtime.js";

vi.mock("virtual:emdash/config", () => ({ default: {} }));
vi.mock("virtual:emdash/wait-until", () => ({ waitUntil: undefined }));
vi.mock("virtual:emdash/scheduler", () => ({ createScheduler: null }));
vi.mock("virtual:emdash/env", () => ({ env: undefined }));
vi.mock("virtual:emdash/build", () => ({ buildTime: 0 }));

test("Content creates, updates and publishes real localized documents with revision history", async () => {
	const runtime = await EmDashRuntime.create({
		config: {
			database: { entrypoint: `content-test-${crypto.randomUUID()}`, config: {}, type: "sqlite" },
		},
		createDialect: () => new SqliteDialect({ database: openNodeSqliteDatabase(":memory:") }),
		plugins: [],
		sandboxedPluginEntries: [],
		sandboxEnabled: false,
		createSandboxRunner: null,
		createScheduler: null,
	});
	try {
		await runtime.db
			.insertInto("users")
			.values({
				id: "operator",
				email: "operator@example.test",
				name: "Operator",
				role: 50,
				email_verified: 1,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			})
			.execute();
		await runtime.schemaRegistry.createCollection({
			slug: "documents",
			label: "Documents",
			labelSingular: "Document",
		});
		await runtime.schemaRegistry.createField("documents", {
			slug: "title",
			type: "string",
			label: "Title",
		});
		const user = { id: "operator", email: "operator@example.test", role: 50 };
		async function call(path: string, method = "GET", body?: unknown) {
			const request = new Request(`https://content.example${path}`, {
				method,
				headers: { "Content-Type": "application/json" },
				...(body ? { body: JSON.stringify(body) } : {}),
			});
			return dispatchContentPluginApi(
				{ request, url: new URL(request.url), locals: { emdash: runtime, user } } as APIContext,
				request,
			);
		}
		const created = await call("/_emdash/api/content/documents", "POST", {
			slug: "independent",
			locale: "fr",
			data: { title: "Document autonome" },
		});
		expect(created.status, await created.clone().text()).toBe(201);
		const item = (await created.json()).data.item;
		const updated = await call(`/_emdash/api/content/documents/${item.id}`, "PUT", {
			locale: "fr",
			data: { title: "Document modifié" },
		});
		expect(updated.status, await updated.clone().text()).toBe(200);
		const published = await call(
			`/_emdash/api/content/documents/${item.id}/publish?locale=fr`,
			"POST",
			{},
		);
		expect(published.status, await published.clone().text()).toBe(200);
		const read = await call("/_emdash/api/content/documents?locale=fr&status=published");
		expect(await read.text()).toContain("Document modifié");
		const revisions = await call(`/_emdash/api/content/documents/${item.id}/revisions`);
		expect(revisions.status).toBe(200);
		expect(await revisions.text()).toContain(item.id);
		expect((await call("/_emdash/api/auth/me")).status).toBe(404);
		expect((await call("/_emdash/api/content/views")).status).toBe(404);
	} finally {
		await runtime.stopCron();
		await runtime.db.destroy();
	}
});
