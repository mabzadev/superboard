import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(packageRoot, "schemas", "front-release-input.schema.json");
const outputPath = join(packageRoot, "src", "generated", "front-release-input-validator.js");
const declarationPath = join(
	packageRoot,
	"src",
	"generated",
	"front-release-input-validator.d.ts",
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({
	allErrors: true,
	strict: true,
	code: { esm: true, source: true },
});
const validate = ajv.compile(schema);
const source = `/* Generated from schemas/front-release-input.schema.json. Do not edit. */\n${standaloneCode(
	ajv,
	validate,
)}`;
const declaration = `/* Generated from schemas/front-release-input.schema.json. Do not edit. */
import type { ErrorObject } from "ajv";
import type { FrontReleaseInput } from "../contracts.js";

declare const validate: {
	(data: unknown): data is FrontReleaseInput;
	errors?: ErrorObject[] | null;
};

export default validate;
`;

if (process.argv.includes("--check")) {
	const currentSource = readFileSync(outputPath, "utf8");
	const currentDeclaration = readFileSync(declarationPath, "utf8");
	if (currentSource !== source || currentDeclaration !== declaration) {
		throw new Error("Generated Front Release validator is stale; run pnpm schema:generate");
	}
} else {
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, source);
	writeFileSync(declarationPath, declaration);
}
