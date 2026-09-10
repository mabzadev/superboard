import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createContext, SourceTextModule } from "node:vm";

const catalog = JSON.parse(
	await readFile(
		new URL("../../../config/superboard-plugin-catalog.json", import.meta.url),
		"utf8",
	),
);

for (const { manifest } of catalog.plugins) {
	void test(`${manifest.plugin_id} reads its settings within the sandbox request budget`, async () => {
		const source = await readFile(
			new URL(`../dist/${manifest.plugin_id}.js`, import.meta.url),
			"utf8",
		);
		const module = new SourceTextModule(source, { context: createContext({ Request }) });
		await module.link(() => {
			throw new Error("Sandbox plugin bundles must be self-contained");
		});
		await module.evaluate();
		const plugin = module.namespace.default;
		const publicKey = Object.entries(plugin.admin.settingsSchema).find(
			([, field]) => field.type !== "secret",
		)[0];
		const secretKey = Object.entries(plugin.admin.settingsSchema).find(
			([, field]) => field.type === "secret",
		)?.[0];
		const stored = new Map([
			[`settings:${publicKey}`, false],
			["settings:unknown", "private"],
			["other:key", "private"],
		]);
		if (secretKey) stored.set(`settings:${secretKey}`, "private-secret");
		for (const route of ["health", "settings/effective"]) {
			let requests = 0;
			const useRequest = () => {
				if (++requests > 10) throw new Error("Too many subrequests by single Worker invocation");
			};
			const kv = {
				async get(key) {
					useRequest();
					return stored.get(key) ?? null;
				},
				async list(prefix) {
					useRequest();
					return [...stored]
						.filter(([key]) => key.startsWith(prefix))
						.map(([key, value]) => ({ key, value }));
				},
			};
			const result = await plugin.routes[route].handler({ kv });
			if (route === "health") assert.equal(result.status, "ready");
			const settings = route === "health" ? result.settings : result;
			assert.equal(settings.values[publicKey], false);
			if (secretKey) {
				assert.equal(settings.secrets_set[secretKey], true);
				assert.equal(settings.values[secretKey], undefined);
			}
			assert.equal(settings.values.unknown, undefined);
			assert.ok(!JSON.stringify(result).includes("private-secret"));
			for (const [key, value] of Object.entries(settings.values)) {
				if (key !== publicKey) assert.equal(value, null);
			}
		}
	});
}

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
