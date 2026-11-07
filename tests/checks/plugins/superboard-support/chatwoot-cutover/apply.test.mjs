import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	applyRenderedChatwoot,
	CHATWOOT_BACKUPS,
	chatwootConfirmation,
	validateChatwootApplySafety,
} from "../../../../../packages/plugins/superboard-support/scripts/chatwoot-cutover/apply.mjs";

function window() {
	return {
		schema_version: 1,
		window_id: "chatwoot-window-2026",
		starts_at: "2026-08-08T10:00:00.000Z",
		ends_at: "2026-08-08T14:00:00.000Z",
		superboard_maintenance: { enabled: true },
		chatwoot_maintenance: { enabled: true },
		backup_receipt: {
			artifacts: CHATWOOT_BACKUPS.map((name) => ({ name, bytes: 10, sha256: "a".repeat(64) })),
		},
	};
}

test("Chatwoot production apply requires exact confirmation, maintenance and four backups", () => {
	const confirm = chatwootConfirmation(
		"reference-production",
		"production",
		12,
		"chatwoot-window-2026",
	);
	assert.deepEqual(
		validateChatwootApplySafety({
			targetName: "reference-production",
			environment: "production",
			projectId: 12,
			window: window(),
			confirm,
			allowProduction: true,
			now: new Date("2026-08-08T12:00:00.000Z"),
		}),
		{ windowId: "chatwoot-window-2026" },
	);
	assert.throws(
		() =>
			validateChatwootApplySafety({
				targetName: "reference-production",
				environment: "production",
				projectId: 12,
				window: window(),
				confirm: "wrong",
				allowProduction: true,
				now: new Date("2026-08-08T12:00:00.000Z"),
			}),
		/pass --confirm/u,
	);
	const missing = window();
	missing.backup_receipt.artifacts.pop();
	assert.throws(
		() =>
			validateChatwootApplySafety({
				targetName: "reference-production",
				environment: "production",
				projectId: 12,
				window: missing,
				confirm,
				allowProduction: true,
				now: new Date("2026-08-08T12:00:00.000Z"),
			}),
		/module-support/u,
	);
});

test("Chatwoot attachments are uploaded under the support folder of the bucket", async () => {
	const directory = await mkdtemp(join(tmpdir(), "superboard-chatwoot-apply-"));
	try {
		const source = join(directory, "proof.png");
		await writeFile(source, "attachment bytes");
		const r2Commands = [];
		const execute = (_command, args, { capture } = {}) => {
			if (capture) return { stdout: JSON.stringify([{ results: [{}] }]) };
			if (args[0] === "wrangler" && args[1] === "r2") {
				r2Commands.push(`${args[3]} ${args[4]}`);
				if (args[3] === "get") copyFileSync(source, args[args.indexOf("--file") + 1]);
			}
			return undefined;
		};

		await applyRenderedChatwoot({
			rendered: {
				planSha256: "plan",
				plan: { source: { account_id: 1 }, destination: { project_id: 12 }, evidence: {} },
				sqlPath: join(directory, "support-import.sql"),
				uploads: {
					bucket_name: "superboard-files",
					objects: [
						{
							storage_key: "attachments/12/20/30/0-proof.png",
							sha256: createHash("sha256").update("attachment bytes").digest("hex"),
							source_path: source,
							content_type: "image/png",
						},
					],
				},
			},
			target: { environments: { development: { moduleD1: { support: { id: "support-db" } } } } },
			targetName: "mabza-development",
			environment: "development",
			checkpointPath: join(directory, "checkpoint.json"),
			env: {},
			execute,
		});

		assert.deepEqual(r2Commands, [
			"put superboard-files/support/attachments/12/20/30/0-proof.png",
			"get superboard-files/support/attachments/12/20/30/0-proof.png",
		]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
