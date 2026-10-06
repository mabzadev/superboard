import assert from "node:assert/strict";
import test from "node:test";

import { runnerControlRequest } from "../../../scripts/cloudflare/installation-runner.mjs";

const environment = {
	GITHUB_ACTIONS: "true",
	ACTIONS_ID_TOKEN_REQUEST_URL: "https://fixture.actions.githubusercontent.com/token",
	ACTIONS_ID_TOKEN_REQUEST_TOKEN: "fixture-identity",
	SUPERBOARD_INSTALLER_ORIGIN: "https://installer.example",
};

test("a transient queue-read failure recovers without requiring another workflow", async () => {
	let attempts = 0;
	const result = await runnerControlRequest(environment, "/runner/jobs", undefined, {
		fetchImpl: async (url) => {
			if (new URL(url).hostname.endsWith(".actions.githubusercontent.com"))
				return Response.json({ value: "fixture-jwt" });
			attempts++;
			return attempts === 1
				? Response.json({ error: "INSTALLATION_SOURCE_UNAVAILABLE" }, { status: 503 })
				: Response.json({ result: [{ id: "queued-installation" }] });
		},
		wait: async () => {},
	});
	assert.deepEqual(result, [{ id: "queued-installation" }]);
	assert.equal(attempts, 2);
});

for (const [label, status, body, expectedAttempts] of [
	["a claim", 503, { id: "installation" }, 1],
	["an authorization failure", 403, undefined, 1],
	["persistent unavailability", 503, undefined, 4],
]) {
	test(`runner retries remain bounded for ${label}`, async () => {
		let attempts = 0;
		await assert.rejects(
			runnerControlRequest(environment, body ? "/runner/claim" : "/runner/jobs", body, {
				fetchImpl: async (url) => {
					if (new URL(url).hostname.endsWith(".actions.githubusercontent.com"))
						return Response.json({ value: "fixture-jwt" });
					attempts++;
					return Response.json({ error: "fixture" }, { status });
				},
				wait: async () => {},
			}),
			new RegExp(`INSTALLATION_RUN_API:${status}`, "u"),
		);
		assert.equal(attempts, expectedAttempts);
	});
}
