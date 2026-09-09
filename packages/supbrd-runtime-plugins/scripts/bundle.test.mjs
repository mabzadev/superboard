import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createContext, SourceTextModule } from "node:vm";

void test("the built Analytics plugin renders French in a sandbox without Node globals", async () => {
	const source = await readFile(
		new URL("../dist/supbrd-plug-analytics.js", import.meta.url),
		"utf8",
	);
	const module = new SourceTextModule(source, { context: createContext({ Request }) });
	await module.link(() => {
		throw new Error("Sandbox plugin bundles must be self-contained");
	});
	await module.evaluate();
	const response = await module.namespace.default.routes.admin.handler({
		request: new Request(
			"https://console.test/_emdash/api/plugins/supbrd-plugmod-analytics/admin",
			{
				headers: { Cookie: "emdash-locale=fr" },
			},
		),
	});
	assert.equal(
		response.blocks.find((block) => block.type === "fields").fields[0].label,
		"Paramètres",
	);
	const sandboxResponse = await module.namespace.default.routes.admin.handler({
		request: {
			url: "https://console.test/_emdash/api/plugins/supbrd-plugmod-analytics/admin",
			method: "POST",
			headers: { "accept-language": "fr" },
		},
	});
	assert.equal(
		sandboxResponse.blocks.find((block) => block.type === "fields").fields[0].label,
		"Paramètres",
	);
});
