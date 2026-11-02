import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, it, expect, beforeAll, afterEach } from "vitest";

import { createDatabase } from "../../../../../../packages/core/src/database/connection.js";
import { runMigrations } from "../../../../../../packages/core/src/database/migrations/runner.js";
import { applySeed } from "../../../../../../packages/core/src/seed/apply.js";
import type { SeedFile } from "../../../../../../packages/core/src/seed/types.js";
import { validateSeed } from "../../../../../../packages/core/src/seed/validate.js";
import { LocalStorage } from "../../../../../../packages/core/src/storage/local.js";
import { ensureBuilt } from "../server.js";

const exec = promisify(execFile);

const WORKSPACE_ROOT = resolve(import.meta.dirname, "../../../../../..");
const CLI_BIN = resolve(import.meta.dirname, "../../../../../../packages/core/dist/cli/index.mjs");
const VALIDATION_FAILED_RE = /validation failed/i;

interface SiteFixture {
	name: string;
	dir: string;
	seedPath: string;
	seed: SeedFile;
}

function discoverFixtures(): SiteFixture[] {
	const fixtures: SiteFixture[] = [];

	const dirs = [
		{ prefix: "templates", path: resolve(WORKSPACE_ROOT, "templates") },
		{ prefix: "demos", path: resolve(WORKSPACE_ROOT, "demos") },
	];

	for (const { prefix, path: parentDir } of dirs) {
		if (!existsSync(parentDir)) continue;

		for (const entry of readdirSync(parentDir)) {
			const dir = join(parentDir, entry);

			let seedPath = join(dir, ".emdash", "seed.json");
			const pkgPath = join(dir, "package.json");

			if (existsSync(pkgPath)) {
				try {
					const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
					if (pkg.emdash?.seed) {
						seedPath = join(dir, pkg.emdash.seed);
					}
				} catch {}
			}

			if (!existsSync(seedPath)) continue;

			const raw = readFileSync(seedPath, "utf-8");
			const seed = JSON.parse(raw) as SeedFile;

			fixtures.push({
				name: `${prefix}/${entry}`,
				dir,
				seedPath,
				seed,
			});
		}
	}

	return fixtures;
}

const fixtures = discoverFixtures();

describe("Seed Fixture Smoke Tests", () => {
	let tempDirs: string[] = [];

	beforeAll(async () => {
		await ensureBuilt();
	}, 120_000);

	afterEach(() => {
		for (const dir of tempDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		tempDirs = [];
	});

	function createTempDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "emdash-smoke-"));
		tempDirs.push(dir);
		return dir;
	}

	it("discovers at least one template/demo with a seed file", () => {
		expect(fixtures.length).toBeGreaterThanOrEqual(1);
		const names = fixtures.map((f) => f.name);
		expect(names).toContain("templates/blog");
	});

	for (const fixture of fixtures) {
		describe(fixture.name, () => {
			it("has a valid seed.json that parses as JSON", () => {
				expect(fixture.seed).toBeDefined();
				expect(fixture.seed.version).toBe("1");
			});

			it("passes programmatic seed validation", () => {
				const result = validateSeed(fixture.seed);
				if (!result.valid) {
					expect.fail(`Seed validation failed:\n${result.errors.join("\n")}`);
				}
				expect(result.valid).toBe(true);
			});

			it("passes CLI seed --validate", async () => {
				const { stdout, stderr } = await exec(
					"node",
					[CLI_BIN, "seed", fixture.seedPath, "--validate"],
					{
						cwd: fixture.dir,
						timeout: 15_000,
					},
				);
				expect(stdout + stderr).not.toMatch(VALIDATION_FAILED_RE);
			});

			it("applies seed to a fresh database without errors", { timeout: 30_000 }, async () => {
				const tempDir = createTempDir();
				const dbPath = join(tempDir, "test.db");
				const uploadsDir = join(tempDir, "uploads");
				mkdirSync(uploadsDir, { recursive: true });

				const db = createDatabase({ url: `file:${dbPath}` });

				try {
					const { applied } = await runMigrations(db);
					expect(applied.length).toBeGreaterThan(0);

					const storage = new LocalStorage({
						directory: uploadsDir,
						baseUrl: "/_emdash/api/media/file",
					});

					const result = await applySeed(db, fixture.seed, {
						includeContent: true,
						onConflict: "skip",
						storage,
						mediaBasePath: join(fixture.dir, ".emdash"),
					});

					if (fixture.seed.collections && fixture.seed.collections.length > 0) {
						expect(result.collections.created).toBeGreaterThan(0);
					}

					const totalFields =
						fixture.seed.collections?.reduce((sum, c) => sum + (c.fields?.length ?? 0), 0) ?? 0;
					if (totalFields > 0) {
						expect(result.fields.created).toBeGreaterThan(0);
					}

					if (fixture.seed.content) {
						const totalEntries = Object.values(fixture.seed.content).reduce(
							(sum, entries) => sum + (Array.isArray(entries) ? entries.length : 0),
							0,
						);
						if (totalEntries > 0) {
							expect(result.content.created).toBeGreaterThan(0);
						}
					}

					if (fixture.seed.taxonomies && fixture.seed.taxonomies.length > 0) {
						expect(result.taxonomies.created + result.taxonomies.terms).toBeGreaterThanOrEqual(0);
					}

					if (fixture.seed.menus && fixture.seed.menus.length > 0) {
						expect(result.menus.created).toBeGreaterThan(0);
					}
				} finally {
					await db.destroy();
				}
			});

			it("passes CLI doctor after seed apply", { timeout: 30_000 }, async () => {
				const tempDir = createTempDir();
				const dbPath = join(tempDir, "test.db");

				await exec("node", [CLI_BIN, "seed", fixture.seedPath, "--database", dbPath], {
					cwd: fixture.dir,
					timeout: 30_000,
				});

				const { stdout } = await exec("node", [CLI_BIN, "doctor", "--database", dbPath, "--json"], {
					cwd: fixture.dir,
					timeout: 15_000,
				});

				const checks = JSON.parse(stdout) as Array<{
					name: string;
					status: "pass" | "warn" | "fail";
					message: string;
				}>;

				const failures = checks.filter((c) => c.status === "fail");
				if (failures.length > 0) {
					expect.fail(
						`Doctor failures:\n${failures.map((f) => `  ${f.name}: ${f.message}`).join("\n")}`,
					);
				}

				const dbCheck = checks.find((c) => c.name === "database");
				expect(dbCheck?.status).toBe("pass");

				const migrationsCheck = checks.find((c) => c.name === "migrations");
				expect(migrationsCheck?.status).toBe("pass");

				const collectionsCheck = checks.find((c) => c.name === "collections");
				expect(collectionsCheck?.status).toBe("pass");
			});

			it(
				"can re-apply seed with on-conflict=skip without errors",
				{ timeout: 30_000 },
				async () => {
					const tempDir = createTempDir();
					const dbPath = join(tempDir, "test.db");
					const uploadsDir = join(tempDir, "uploads");
					mkdirSync(uploadsDir, { recursive: true });

					const db = createDatabase({ url: `file:${dbPath}` });

					try {
						await runMigrations(db);

						const storage = new LocalStorage({
							directory: uploadsDir,
							baseUrl: "/_emdash/api/media/file",
						});

						const seedOpts = {
							includeContent: true,
							onConflict: "skip" as const,
							storage,
							seedDir: join(fixture.dir, ".emdash"),
						};

						await applySeed(db, fixture.seed, seedOpts);

						const result2 = await applySeed(db, fixture.seed, seedOpts);

						expect(result2.collections.created).toBe(0);
					} finally {
						await db.destroy();
					}
				},
			);

			it("has package.json with emdash.seed pointing to the seed file", () => {
				const pkgPath = join(fixture.dir, "package.json");
				if (!existsSync(pkgPath)) return;
				const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

				const seedRef = pkg.emdash?.seed;
				if (seedRef) {
					const resolvedSeedPath = resolve(fixture.dir, seedRef);
					expect(existsSync(resolvedSeedPath)).toBe(true);
				} else {
					expect(existsSync(fixture.seedPath)).toBe(true);
				}
			});
		});
	}

	describe("Required files", () => {
		const roots = [
			{ prefix: "templates", dir: resolve(WORKSPACE_ROOT, "templates") },
			{ prefix: "demos", dir: resolve(WORKSPACE_ROOT, "demos") },
		].filter((root) => existsSync(root.dir));

		const allDirs = roots
			.flatMap((root) =>
				readdirSync(root.dir).map((entry) => ({
					name: `${root.prefix}/${entry}`,
					dir: join(root.dir, entry),
				})),
			)
			.filter((d) => existsSync(join(d.dir, "package.json")));

		for (const { name, dir } of allDirs) {
			describe(name, () => {
				it("has astro.config.mjs", () => {
					expect(existsSync(join(dir, "astro.config.mjs"))).toBe(true);
				});

				it("has tsconfig.json", () => {
					expect(existsSync(join(dir, "tsconfig.json"))).toBe(true);
				});

				it("has live.config.ts with emdashLoader", () => {
					const liveConfig = join(dir, "src", "live.config.ts");
					expect(existsSync(liveConfig)).toBe(true);

					const content = readFileSync(liveConfig, "utf-8");
					expect(content).toContain("emdashLoader");
					expect(content).toContain("defineLiveCollection");
				});

				it("has typecheck script in package.json", () => {
					const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
					expect(pkg.scripts?.typecheck || pkg.scripts?.check).toBeDefined();
				});

				it("uses workspace:* for emdash dependency", () => {
					const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
					expect(pkg.dependencies?.emdash).toBe("workspace:*");
				});

				it("uses catalog: for astro dependency", () => {
					const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
					const astroVersion = pkg.dependencies?.astro;
					expect(astroVersion).toBe("catalog:");
				});
			});
		}
	});
});
