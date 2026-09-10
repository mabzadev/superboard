import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../../..");
const gate = resolve(root, "packages/plugins/supbrd-plug-support/scripts/parity-check.mjs");
const publicationGate = resolve(
	root,
	"packages/plugins/supbrd-plug-support/scripts/public-leak-check.mjs",
);

test("the internal Support reference has exactly 758 mapped route records", () => {
	const manifest = JSON.parse(
		readFileSync(
			resolve(
				root,
				"packages/plugins/supbrd-plug-support/scripts/support-audit/reference-routes.json",
			),
			"utf8",
		),
	);
	const capabilities = JSON.parse(
		readFileSync(
			resolve(root, "packages/plugins/supbrd-plug-support/scripts/support-audit/capabilities.json"),
			"utf8",
		),
	);
	assert.equal(manifest.internal_only, true);
	assert.equal(capabilities.schema_version, 2);
	assert.equal(manifest.route_method_count, 758);
	assert.equal(manifest.routes.length, 758);
	assert.equal(
		manifest.routes.some((route) =>
			["unknown", "partial", "not_ported"].includes(route.disposition),
		),
		false,
	);
	for (const capability of capabilities.capabilities.filter(
		({ disposition }) => disposition === "implemented",
	)) {
		assert.ok(
			capability.dimensions.tests.length > 0,
			`${capability.id} needs an executable test proof`,
		);
		for (const proof of capability.dimensions.tests) {
			assert.equal(typeof proof.file, "string");
			assert.equal(typeof proof.runner, "string");
			assert.ok(proof.behavior_tokens.length >= 2);
		}
	}
});

test("the Support parity and publication gates pass", () => {
	for (const script of [
		"packages/plugins/supbrd-plug-support/scripts/parity-check.mjs",
		"packages/plugins/supbrd-plug-support/scripts/public-leak-check.mjs",
	]) {
		const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
		assert.equal(result.status, 0, `${script}\n${result.stdout}\n${result.stderr}`);
	}
});

test("the parity gate accepts a real executable behavioral proof", (context) => {
	const fixture = parityFixture({
		source: `
      import { expect, it } from "vitest";
      it("persists the domain mutation", () => {
        const result = { status: "persisted-domain-result" };
        expect(result).toEqual({ status: "persisted-domain-result" });
      });
    `,
		tokens: ["persists the domain mutation", "persisted-domain-result"],
	});
	context.after(fixture.remove);
	const result = runFixture(fixture.root);
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("the parity gate rejects empty and placeholder test evidence", async (context) => {
	await context.test("empty file", () => {
		const fixture = parityFixture({
			source: "",
			tokens: ["persists the domain mutation", "persisted-domain-result"],
		});
		context.after(fixture.remove);
		const result = runFixture(fixture.root);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /empty evidence file/u);
	});
	await context.test("placeholder assertion", () => {
		const fixture = parityFixture({
			source: `
        import { expect, it } from "vitest";
        it("persists the domain mutation", () => {
          // PLACEHOLDER until the real behavior exists.
          const result = "persisted-domain-result";
          expect(true).toBe(true);
        });
      `,
			tokens: ["persists the domain mutation", "persisted-domain-result"],
		});
		context.after(fixture.remove);
		const result = runFixture(fixture.root);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /placeholder test evidence is forbidden/u);
	});
});

test("the parity gate rejects a declared behavioral token absent from the test", (context) => {
	const fixture = parityFixture({
		source: `
      import { expect, it } from "vitest";
      it("persists the domain mutation", () => {
        const result = "persisted-domain-result";
        expect(result).toBe("persisted-domain-result");
      });
    `,
		tokens: ["persists the domain mutation", "missing-domain-result"],
	});
	context.after(fixture.remove);
	const result = runFixture(fixture.root);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /missing behavioral token.*missing-domain-result/u);
});

test("the publication gate rejects an internal audit fingerprint in Site artifacts", (context) => {
	const fixtureRoot = mkdtempSync(join(tmpdir(), "support-artifact-"));
	context.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
	const auditDirectory = join(
		fixtureRoot,
		"packages/plugins/supbrd-plug-support/scripts/support-audit",
	);
	const artifactDirectory = join(fixtureRoot, "apps/site/dist/client/_astro");
	mkdirSync(auditDirectory, { recursive: true });
	mkdirSync(artifactDirectory, { recursive: true });
	writeFileSync(
		join(auditDirectory, "capabilities.json"),
		JSON.stringify({
			reference: {
				commit: "private-reference-commit",
				canonical_route_sha256: "private-reference-route-digest",
			},
		}),
	);
	const artifact = join(artifactDirectory, "support.js");
	writeFileSync(artifact, "globalThis.__audit = 'private-reference-commit';\n");

	const leaked = spawnSync(process.execPath, [publicationGate, "--root", fixtureRoot], {
		cwd: root,
		encoding: "utf8",
	});
	assert.equal(leaked.status, 1);
	assert.match(leaked.stderr, /internal Support reference commit/u);

	writeFileSync(artifact, "globalThis.__support = 'public-runtime';\n");
	const clean = spawnSync(process.execPath, [publicationGate, "--root", fixtureRoot], {
		cwd: root,
		encoding: "utf8",
	});
	assert.equal(clean.status, 0, `${clean.stdout}\n${clean.stderr}`);
});

test("the publication gate rejects migration vocabulary from a published Support surface", (context) => {
	const fixtureRoot = mkdtempSync(join(tmpdir(), "support-public-copy-"));
	context.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
	const auditDirectory = join(
		fixtureRoot,
		"packages/plugins/supbrd-plug-support/scripts/support-audit",
	);
	const supportDirectory = join(
		fixtureRoot,
		"packages/plugins/supbrd-plug-support/src/front/components/modules",
	);
	mkdirSync(auditDirectory, { recursive: true });
	mkdirSync(supportDirectory, { recursive: true });
	writeFileSync(
		join(auditDirectory, "capabilities.json"),
		JSON.stringify({
			reference: {
				commit: "private-reference-commit",
				canonical_route_sha256: "private-reference-route-digest",
			},
		}),
	);
	const surface = join(supportDirectory, "SupportInboxPage.tsx");
	writeFileSync(surface, "export const copy = 'Legacy migration status';\n");

	const leaked = spawnSync(process.execPath, [publicationGate, "--root", fixtureRoot], {
		cwd: root,
		encoding: "utf8",
	});
	assert.equal(leaked.status, 1);
	assert.match(leaked.stderr, /migration vocabulary/u);

	writeFileSync(surface, "export const copy = 'Support inbox ready';\n");
	const clean = spawnSync(process.execPath, [publicationGate, "--root", fixtureRoot], {
		cwd: root,
		encoding: "utf8",
	});
	assert.equal(clean.status, 0, `${clean.stdout}\n${clean.stderr}`);
});

function runFixture(fixtureRoot) {
	return spawnSync(process.execPath, [gate, "--root", fixtureRoot], {
		cwd: root,
		encoding: "utf8",
	});
}

function parityFixture({ source, tokens }) {
	const fixtureRoot = mkdtempSync(join(tmpdir(), "support-parity-"));
	const auditDirectory = join(
		fixtureRoot,
		"packages/plugins/supbrd-plug-support/scripts/support-audit",
	);
	const sourceDirectory = join(fixtureRoot, "packages/plugins/supbrd-plug-support/worker/src");
	const testDirectory = join(fixtureRoot, "tests/checks/plugins/supbrd-plug-support/worker/unit");
	mkdirSync(auditDirectory, { recursive: true });
	mkdirSync(sourceDirectory, { recursive: true });
	writeFileSync(
		join(sourceDirectory, "domain.ts"),
		"export function persistDomain() { return 'persisted-domain-result'; }\n",
	);
	mkdirSync(testDirectory, { recursive: true });
	writeFileSync(join(testDirectory, "domain.test.ts"), source);
	const canonicalRoute = {
		name: "domain",
		verb: "POST",
		path: "/internal/v1/domain",
		controller: "domain",
		action: "create",
		internal: true,
	};
	const fingerprint = createHash("sha256").update(JSON.stringify(canonicalRoute)).digest("hex");
	const reference = {
		repository: "internal/reference",
		commit: "fixture-commit",
		route_method_count: 1,
		canonical_route_sha256: "fixture-route-inventory",
	};
	const proof = {
		file: "tests/checks/plugins/supbrd-plug-support/worker/unit/domain.test.ts",
		runner: "vitest-support",
		behavior_tokens: tokens,
	};
	writeFileSync(
		join(auditDirectory, "capabilities.json"),
		JSON.stringify(
			{
				schema_version: 2,
				internal_only: true,
				reference,
				capabilities: [
					{
						id: "domain",
						disposition: "implemented",
						authority: "Fixture",
						dimensions: {
							behavior: ["packages/plugins/supbrd-plug-support/worker/src/domain.ts"],
							persistence: ["packages/plugins/supbrd-plug-support/worker/src/domain.ts"],
							asynchronous: ["packages/plugins/supbrd-plug-support/worker/src/domain.ts"],
							rbac: ["packages/plugins/supbrd-plug-support/worker/src/domain.ts"],
							interface: ["packages/plugins/supbrd-plug-support/worker/src/domain.ts"],
							tests: [proof],
						},
					},
				],
			},
			null,
			2,
		),
	);
	writeFileSync(
		join(auditDirectory, "reference-routes.json"),
		JSON.stringify(
			{
				schema_version: 1,
				internal_only: true,
				reference_commit: reference.commit,
				route_method_count: 1,
				canonical_route_sha256: reference.canonical_route_sha256,
				routes: [
					{
						...canonicalRoute,
						fingerprint,
						capability: "domain",
						disposition: "implemented",
						mapping_rule: "fixture behavior",
					},
				],
			},
			null,
			2,
		),
	);
	return {
		root: fixtureRoot,
		remove: () => rmSync(fixtureRoot, { recursive: true, force: true }),
	};
}
