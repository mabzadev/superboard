import { describe, it, expect, vi } from "vitest";

import { getPageRuntime } from "../../../../../../packages/core/src/page/index.js";

describe("getPageRuntime", () => {
	it("returns undefined when locals has no emdash property", () => {
		const locals: Record<string, unknown> = {};

		const result = getPageRuntime(locals);

		expect(result).toBeUndefined();
	});

	it("returns undefined when locals.emdash is null", () => {
		const locals: Record<string, unknown> = { emdash: null };

		const result = getPageRuntime(locals);

		expect(result).toBeUndefined();
	});

	it("returns undefined when locals.emdash is missing collectPageMetadata", () => {
		const locals: Record<string, unknown> = {
			emdash: {
				collectPageFragments: vi.fn(),
			},
		};

		const result = getPageRuntime(locals);

		expect(result).toBeUndefined();
	});

	it("returns undefined when locals.emdash is missing collectPageFragments", () => {
		const locals: Record<string, unknown> = {
			emdash: {
				collectPageMetadata: vi.fn(),
			},
		};

		const result = getPageRuntime(locals);

		expect(result).toBeUndefined();
	});

	it("returns the runtime when both page contribution methods are present", () => {
		const collectPageMetadata = vi.fn();
		const collectPageFragments = vi.fn();
		const locals: Record<string, unknown> = {
			emdash: {
				collectPageMetadata,
				collectPageFragments,
			},
		};

		const result = getPageRuntime(locals);

		expect(result).toBeDefined();
		expect(result!.collectPageMetadata).toBe(collectPageMetadata);
		expect(result!.collectPageFragments).toBe(collectPageFragments);
	});

	it("returns the runtime from a full middleware-shaped locals.emdash", () => {
		const collectPageMetadata = vi.fn();
		const collectPageFragments = vi.fn();
		const locals: Record<string, unknown> = {
			emdash: {
				handleContentList: vi.fn(),
				handleContentGet: vi.fn(),
				handleContentCreate: vi.fn(),
				handleContentUpdate: vi.fn(),
				handleContentDelete: vi.fn(),
				handleMediaList: vi.fn(),
				handlePluginApiRoute: vi.fn(),
				collectPageMetadata,
				collectPageFragments,
				storage: null,
				db: {},
				hooks: {},
				config: {},
			},
		};

		const result = getPageRuntime(locals);

		expect(result).toBeDefined();
		expect(result!.collectPageMetadata).toBe(collectPageMetadata);
		expect(result!.collectPageFragments).toBe(collectPageFragments);
	});
});
