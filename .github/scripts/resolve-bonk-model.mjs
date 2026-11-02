#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const registryPath = resolve(here, "..", "bonk-models.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));

const body = process.env.BODY ?? "";

const triggerRe = /(?:^|\s)(?:\/bonk|\/review|@ask-bonk)\s+([a-zA-Z][a-zA-Z0-9_-]*)/;
const match = body.match(triggerRe);
const requested = match ? match[1].toLowerCase() : null;

const fallback = registry.default;
const alias = requested && registry.models[requested] ? requested : fallback;
const entry = registry.models[alias];
if (!entry) {
	console.error(`bonk-models.json default "${fallback}" missing from models map`);
	process.exit(1);
}

const model = `cloudflare-ai-gateway/${entry.id}`;

const opencodeConfig = {
	permission: {
		external_directory: {
			"*": "deny",
			"/tmp/**": "allow",
			"~/**": "allow",
		},
		doom_loop: "deny",
	},
	provider: {
		"cloudflare-ai-gateway": {
			models: {
				[entry.id]: entry.registration,
			},
		},
	},
};

const out = process.env.GITHUB_OUTPUT;
if (!out) {
	console.error("GITHUB_OUTPUT is not set");
	process.exit(1);
}

const eof = "OPENCODE_CONFIG_EOF";
appendFileSync(
	out,
	[
		`alias=${alias}`,
		`requested=${requested ?? ""}`,
		`model=${model}`,
		`opencode_config<<${eof}`,
		JSON.stringify(opencodeConfig),
		eof,
		"",
	].join("\n"),
);

console.log(`Resolved alias "${alias}" -> ${model}`);
