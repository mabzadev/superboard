import { describe, expect, it } from "vitest";

import { wpPrepareBody } from "../../../../../../packages/core/src/api/schemas/import.js";

describe("wpPrepareBody schema", () => {
	it("accepts fields as an array of ImportFieldDef objects", () => {
		const input = {
			postTypes: [
				{
					name: "post",
					collection: "posts",
					fields: [
						{
							slug: "content",
							label: "Content",
							type: "portableText",
							required: true,
							searchable: true,
						},
						{
							slug: "excerpt",
							label: "Excerpt",
							type: "text",
							required: false,
						},
					],
				},
			],
		};

		const result = wpPrepareBody.safeParse(input);
		expect(result.success).toBe(true);
	});

	it("accepts fields with optional searchable property", () => {
		const input = {
			postTypes: [
				{
					name: "page",
					collection: "pages",
					fields: [
						{
							slug: "featured_image",
							label: "Featured Image",
							type: "image",
							required: false,
						},
					],
				},
			],
		};

		const result = wpPrepareBody.safeParse(input);
		expect(result.success).toBe(true);
	});

	it("accepts postTypes without fields (optional)", () => {
		const input = {
			postTypes: [
				{
					name: "post",
					collection: "posts",
				},
			],
		};

		const result = wpPrepareBody.safeParse(input);
		expect(result.success).toBe(true);
	});

	it("rejects fields with missing required properties", () => {
		const input = {
			postTypes: [
				{
					name: "post",
					collection: "posts",
					fields: [
						{
							slug: "content",
						},
					],
				},
			],
		};

		const result = wpPrepareBody.safeParse(input);
		expect(result.success).toBe(false);
	});

	it("accepts multiple postTypes with fields", () => {
		const input = {
			postTypes: [
				{
					name: "post",
					collection: "posts",
					fields: [
						{
							slug: "content",
							label: "Content",
							type: "portableText",
							required: true,
							searchable: true,
						},
					],
				},
				{
					name: "page",
					collection: "pages",
					fields: [
						{
							slug: "content",
							label: "Content",
							type: "portableText",
							required: true,
							searchable: true,
						},
						{
							slug: "featured_image",
							label: "Featured Image",
							type: "image",
							required: false,
						},
					],
				},
			],
		};

		const result = wpPrepareBody.safeParse(input);
		expect(result.success).toBe(true);
	});
});
