import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ManifestSchema } from "../../../../packages/plugin-cli/src/manifest/schema.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const COMMITTED_SCHEMA_PATH = resolve(
	HERE,
	"../../../../packages/plugin-cli/schemas/emdash-plugin.schema.json",
);

describe("JSON Schema drift", () => {
	it("matches the output of z.toJSONSchema(ManifestSchema)", async () => {
		const committed = await readFile(COMMITTED_SCHEMA_PATH, "utf8");

		const jsonSchema = z.toJSONSchema(ManifestSchema, {
			target: "draft-2020-12",
			reused: "ref",
		});
		const document = {
			$schema: "https://json-schema.org/draft/2020-12/schema",
			$id: "https://emdashcms.com/schemas/emdash-plugin.schema.json",
			title: "EmDash plugin manifest (emdash-plugin.jsonc)",
			description:
				"Authoring format for publishing plugins to the EmDash plugin registry. Translated to the on-wire atproto record format at publish time. See https://github.com/emdash-cms/emdash/issues/1028.",
			...jsonSchema,
		};
		const regenerated = `${JSON.stringify(document, null, "\t")}\n`;

		if (committed !== regenerated) {
			throw new Error(
				"schemas/emdash-plugin.schema.json is out of date with the Zod schema.\n" +
					"Run: pnpm --filter @emdash-cms/plugin-cli gen-schema\n" +
					"Then commit the result.",
			);
		}
		expect(committed).toBe(regenerated);
	});
});
