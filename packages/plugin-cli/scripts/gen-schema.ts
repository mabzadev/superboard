import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { ManifestSchema } from "../src/manifest/schema.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(HERE, "..", "schemas", "emdash-plugin.schema.json");

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

const serialised = `${JSON.stringify(document, null, "\t")}\n`;

await mkdir(dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, serialised, "utf8");
process.stdout.write(`Wrote ${OUT_PATH}\n`);
