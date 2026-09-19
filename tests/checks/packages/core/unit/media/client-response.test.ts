import { describe, expect, it } from "vitest";

import {
	readMediaProvidersResponse,
	readMediaListResponse,
	readMediaItemResponse,
} from "../../../../../../packages/core/src/media/client-response.js";

describe("inline media API responses", () => {
	it("reads provider capabilities without requiring optional icons", async () => {
		const provider = {
			id: "local",
			name: "Library",
			capabilities: { browse: true, search: true, upload: true, delete: true },
		};
		expect(
			await readMediaProvidersResponse(Response.json({ data: { items: [provider] } })),
		).toEqual([provider]);
	});
	it("reads lists and normalizes nullable optional media metadata", async () => {
		const items = await readMediaListResponse(
			Response.json({
				data: { items: [{ id: "image", width: null, alt: null, meta: { credit: "Example" } }] },
			}),
		);
		expect(items[0]).toMatchObject({ id: "image", meta: { credit: "Example" } });
		expect(items[0]?.width).toBeUndefined();
		expect(items[0]?.alt).toBeUndefined();
	});
	it.each([false, true])("reads uploaded media with envelope=%s", async (envelope) => {
		const body = { item: { id: "uploaded", filename: "image.png", mimeType: "image/png" } };
		expect(await readMediaItemResponse(Response.json(envelope ? { data: body } : body))).toEqual(
			body.item,
		);
	});
	it.each([readMediaProvidersResponse, readMediaListResponse, readMediaItemResponse])(
		"rejects unsuccessful HTTP responses",
		async (read) => {
			await expect(
				read(Response.json({ data: { items: [], item: { id: "image" } } }, { status: 500 })),
			).rejects.toThrow();
		},
	);
	it("rejects an invalid media list instead of inserting broken items", async () => {
		await expect(
			readMediaListResponse(Response.json({ data: { items: [{ id: 42 }] } })),
		).rejects.toThrow();
	});
	it("rejects upload errors instead of selecting an undefined image", async () => {
		await expect(
			readMediaItemResponse(Response.json({ error: { code: "UPLOAD_FAILED" } })),
		).rejects.toThrow();
	});
	it("rejects malformed provider capabilities", async () => {
		await expect(
			readMediaProvidersResponse(
				Response.json({ data: { items: [{ id: "local", name: "Library", capabilities: "all" }] } }),
			),
		).rejects.toThrow();
	});
});
