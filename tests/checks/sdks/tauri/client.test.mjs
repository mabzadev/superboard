import assert from "node:assert/strict";
import test from "node:test";

import { SuperBoardTauri } from "../../../../sdks/tauri/src/index.js";

await test("Tauri uses the configured Web project context through its injected native transport", async () => {
	let captured;
	const client = new SuperBoardTauri({
		apiUrl: "https://api.example.test",
		projectKey: "project",
		appId: "app.example.test",
		fetch: async (url, options) => {
			captured = { url, options };
			return Response.json({ data: { enabled: true } });
		},
	});
	assert.deepEqual(await client.request("/api/v1/app/runtime-policy", { authenticated: false }), {
		enabled: true,
	});
	assert.equal(captured.url, "https://api.example.test/api/v1/app/runtime-policy");
	assert.equal(captured.options.headers.get("PLATFORM"), "web");
	assert.equal(captured.options.headers.get("IDENTIFIER"), "app.example.test");
	assert.equal(captured.options.redirect, "error");
});
