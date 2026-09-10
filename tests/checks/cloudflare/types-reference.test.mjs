import "../../fixtures/cloudflare/targets.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { cloudflareTypesMode } from "../../../scripts/cloudflare/types-reference.mjs";

const packageJson = JSON.parse(
	await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
);

test("package scripts make reference and target validation modes unambiguous", () => {
	assert.equal(
		packageJson.scripts["cloudflare:types:check"],
		"node scripts/cloudflare/types-reference.mjs --reference --check",
	);
	assert.equal(
		packageJson.scripts["cloudflare:types:check:target"],
		"node scripts/cloudflare/types-reference.mjs --check",
	);
});

test("reference type generation is explicit and rejects operational context", async () => {
	assert.deepEqual(await cloudflareTypesMode({ reference: true }, {}), {
		targetName: "mbza-development",
		environment: "development",
		reference: true,
		mode: "reference",
		generatorArgs: ["--reference"],
		customSelectionArgs: { all: true },
		customSelectionEnv: {},
	});
	await assert.rejects(
		cloudflareTypesMode(
			{ reference: true },
			{
				SUPERBOARD_TARGET: "mbza-development",
				SUPERBOARD_ENVIRONMENT: "development",
			},
		),
		/cannot be combined with an operational target or environment/u,
	);
});

test("target type generation requires an exact explicit operational selection", async () => {
	await assert.rejects(
		cloudflareTypesMode(
			{},
			{
				SUPERBOARD_TARGET: "mbza-development",
				SUPERBOARD_ENVIRONMENT: "development",
			},
		),
		/explicit --target and --environment/u,
	);
	await assert.rejects(
		cloudflareTypesMode(
			{ target: "reference-production", environment: "production" },
			{
				SUPERBOARD_TARGET: "mbza-development",
				SUPERBOARD_ENVIRONMENT: "production",
			},
		),
		/does not match SUPERBOARD_TARGET/u,
	);
	await assert.rejects(
		cloudflareTypesMode(
			{ target: "reference-production", environment: "development" },
			{
				SUPERBOARD_TARGET: "reference-production",
				SUPERBOARD_ENVIRONMENT: "production",
			},
		),
		/does not match SUPERBOARD_ENVIRONMENT/u,
	);
});

test("target type generation propagates one exact target and environment", async () => {
	const env = {
		SUPERBOARD_TARGET: "reference-production",
		SUPERBOARD_ENVIRONMENT: "production",
	};
	assert.deepEqual(
		await cloudflareTypesMode({ target: "reference-production", environment: "production" }, env),
		{
			targetName: "reference-production",
			environment: "production",
			reference: false,
			mode: "target",
			generatorArgs: ["--target", "reference-production", "--environment", "production"],
			customSelectionArgs: {
				target: "reference-production",
				environment: "production",
			},
			customSelectionEnv: env,
		},
	);
});

test("target type generation prefers canonical SuperBoard selection variables", async () => {
	const env = {
		SUPERBOARD_TARGET: "reference-production",
		SUPERBOARD_ENVIRONMENT: "production",
	};
	const mode = await cloudflareTypesMode(
		{ target: "reference-production", environment: "production" },
		env,
	);
	assert.equal(mode.targetName, "reference-production");
	assert.equal(mode.environment, "production");
});
