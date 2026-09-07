import { expect, test } from "vitest";

import { createCmsApi } from "./retirement-api-cms.js";
import { jsonResult, prepareApiPlugin, proveApi } from "./retirement-api-helpers.js";
const plugin = "supbrd-plug-content";
const file = "retirement-api-content.runtime.test.ts";
type Document = {
	id: string;
	slug: string;
	status: string;
	_rev?: string;
	data: { title: string };
};
test("canonical Content APIs create, revise and publish a persisted document with a taxonomy", async () => {
	await prepareApiPlugin(plugin);
	const cms = await createCmsApi();
	try {
		const collection = `proofdocs_${crypto.randomUUID().replaceAll("-", "")}`;
		const path = `/_emdash/api/content/${collection}`;
		await cms.runtime.schemaRegistry.createCollection({
			slug: collection,
			label: "API documents",
			labelSingular: "API document",
		});
		await cms.runtime.schemaRegistry.createField(collection, {
			slug: "title",
			label: "Title",
			type: "string",
		});
		const created = await jsonResult<{ data: { item: Document } }>(
			await cms.command(plugin, "create_document", {
				method: "POST",
				path,
				body: {
					slug: "persisted-document",
					locale: "en",
					data: { title: "Created through canonical Content" },
				},
			}),
			201,
		);
		const id = created.data.item.id;
		expect(id).toBeTruthy();
		let listed = await jsonResult<{ data: { items: Document[] } }>(
			await cms.read(plugin, "documents", { method: "GET", path: `${path}?locale=en` }),
		);
		expect(listed.data.items).toContainEqual(
			expect.objectContaining({
				id,
				slug: "persisted-document",
				data: expect.objectContaining({ title: "Created through canonical Content" }),
			}),
		);
		proveApi(plugin, "create_document", "mutation", file, [id]);
		proveApi(plugin, "documents", "read", file, [id]);
		await jsonResult(
			await cms.command(plugin, "update_document", {
				method: "PUT",
				path: `${path}/${id}`,
				body: {
					locale: "en",
					data: { title: "Edited through canonical Content" },
					...(created.data.item._rev ? { _rev: created.data.item._rev } : {}),
				},
			}),
		);
		const drafts = await jsonResult<{
			data: { items: Array<{ id: string; data: { title: string } }> };
		}>(await cms.read(plugin, "revisions", { method: "GET", path: `${path}/${id}/revisions` }));
		const changed = drafts.data.items.find(
			(revision) => revision.data.title === "Edited through canonical Content",
		);
		expect(changed).toBeDefined();
		proveApi(plugin, "update_document", "mutation", file, [id, changed!.id]);
		await jsonResult(
			await cms.command(plugin, "publish_document", {
				method: "POST",
				path: `${path}/${id}/publish`,
				body: {},
			}),
		);
		listed = await jsonResult<{ data: { items: Document[] } }>(
			await cms.read(plugin, "documents", { method: "GET", path: `${path}?locale=en` }),
		);
		expect(listed.data.items.find((item) => item.id === id)).toMatchObject({
			status: "published",
			data: { title: "Edited through canonical Content" },
		});
		proveApi(plugin, "publish_document", "mutation", file, [id]);
		const revisions = await jsonResult<{ data: { items: unknown[] } }>(
			await cms.read(plugin, "revisions", { method: "GET", path: `${path}/${id}/revisions` }),
		);
		expect(revisions.data.items.length).toBeGreaterThan(0);
		expect(JSON.stringify(revisions.data.items)).toContain("Edited through canonical Content");
		proveApi(plugin, "revisions", "read", file, [id]);
		const taxonomy = `topics_${crypto.randomUUID().replaceAll("-", "")}`;
		const taxonomyCreated = await jsonResult<{ data: { taxonomy: { id: string } } }>(
			await cms.taxonomy({
				name: taxonomy,
				label: "API topics",
				collections: [collection],
				locale: "en",
			}),
			201,
		);
		const taxonomies = await jsonResult<{
			data: {
				taxonomies: Array<{ id: string; name: string; collections: string[]; locale: string }>;
			};
		}>(
			await cms.read(plugin, "taxonomies", {
				method: "GET",
				path: "/_emdash/api/taxonomies?locale=en",
			}),
		);
		expect(taxonomies.data.taxonomies).toContainEqual(
			expect.objectContaining({
				id: taxonomyCreated.data.taxonomy.id,
				name: taxonomy,
				collections: [collection],
				locale: "en",
			}),
		);
		proveApi(plugin, "taxonomies", "read", file, [taxonomyCreated.data.taxonomy.id]);
	} finally {
		await cms.close();
	}
});
