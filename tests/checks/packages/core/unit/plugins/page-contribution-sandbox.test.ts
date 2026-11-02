import { describe, it, expect } from "vitest";

describe("page contribution sandbox boundary", () => {
	describe("manifest schema validation", () => {
		it("should accept page:metadata in manifests", async () => {
			const { pluginManifestSchema } =
				await import("../../../../../../packages/core/src/plugins/manifest-schema.js");

			const manifest = {
				id: "test-plugin",
				version: "1.0.0",
				capabilities: [],
				allowedHosts: [],
				storage: {},
				hooks: [{ name: "page:metadata" }],
				routes: [],
				admin: { pages: [], widgets: [] },
			};

			const result = pluginManifestSchema.safeParse(manifest);
			expect(result.success).toBe(true);
		});

		it("should accept page:fragments in manifests (enforcement is at runtime)", async () => {
			const { pluginManifestSchema } =
				await import("../../../../../../packages/core/src/plugins/manifest-schema.js");

			const manifest = {
				id: "test-plugin",
				version: "1.0.0",
				capabilities: [],
				allowedHosts: [],
				storage: {},
				hooks: [{ name: "page:fragments" }],
				routes: [],
				admin: { pages: [], widgets: [] },
			};

			const result = pluginManifestSchema.safeParse(manifest);
			expect(result.success).toBe(true);
		});
	});

	describe("fragment collector defense-in-depth", () => {
		it("resolveFragments only processes contributions it receives", async () => {
			const { resolveFragments } =
				await import("../../../../../../packages/core/src/page/fragments.js");

			const result = resolveFragments([], "head");
			expect(result).toEqual([]);
		});
	});
});
