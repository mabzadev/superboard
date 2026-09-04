import assert from "node:assert/strict";
import test from "node:test";

import { buildLocalSite } from "./target-orchestrator.mjs";

test("local target start builds the Site with the selected target email settings", () => {
	const calls = [];
	buildLocalSite(
		{
			target: {
				mail: {
					fromAddress: "noreply@mbza.dev",
					fromName: "SuperBoard Development",
					replyToAddress: "support@mbza.dev",
				},
			},
		},
		(command, args, env) => calls.push({ command, args, env }),
		{},
	);

	assert.deepEqual(calls, [
		{
			command: "pnpm",
			args: ["site:build"],
			env: {
				SUPERBOARD_SITE_EMAIL_FROM_ADDRESS: "noreply@mbza.dev",
				SUPERBOARD_SITE_EMAIL_FROM_NAME: "SuperBoard Development",
				SUPERBOARD_SITE_EMAIL_REPLY_TO: "support@mbza.dev",
			},
		},
	]);
});
