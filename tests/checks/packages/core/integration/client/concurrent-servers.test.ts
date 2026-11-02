import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect, afterAll } from "vitest";

import type { TestServerContext } from "../server.js";
import { assertNodeVersion, createTestServer } from "../server.js";

const PORT_A = 4402;
const PORT_B = 4403;

describe("Concurrent dev servers (#1604)", () => {
	const contexts: TestServerContext[] = [];

	afterAll(async () => {
		await Promise.all(contexts.map((ctx) => ctx.cleanup()));
	});

	it("boots two servers from the same fixture in parallel without colliding on the Astro lock", async () => {
		assertNodeVersion();

		async function startTracked(port: number): Promise<TestServerContext> {
			const ctx = await createTestServer({ port });
			contexts.push(ctx);
			return ctx;
		}

		const [a, b] = await Promise.all([startTracked(PORT_A), startTracked(PORT_B)]);

		for (const cwd of [a.cwd, b.cwd]) {
			const cacheDir = join(cwd, ".vite-cache");
			expect(existsSync(cacheDir), `${cacheDir} was never created`).toBe(true);
			const output = readdirSync(cacheDir, { recursive: true, withFileTypes: true });
			expect(
				output.some((entry) => entry.isFile()),
				`${cacheDir} contains no Vite cache output`,
			).toBe(true);
		}

		const [collectionsA, collectionsB] = await Promise.all([
			a.client.collections(),
			b.client.collections(),
		]);
		for (const collections of [collectionsA, collectionsB]) {
			const slugs = collections.map((c: { slug: string }) => c.slug);
			expect(slugs).toContain("posts");
			expect(slugs).toContain("pages");
		}
	}, 120_000);
});
