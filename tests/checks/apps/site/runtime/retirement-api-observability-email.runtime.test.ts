import { SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import { quarantineEmailDeadLetter } from "../../../../../packages/plugins/supbrd-plug-communication/email/src/index.js";
import {
	apiCommand,
	apiHeaders,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";

const plugin = "supbrd-plugmod-observability";
const file = "retirement-api-observability-email.runtime.test.ts";
test("Observability reads actual Email failures and replays or discards the persisted dead letters", async () => {
	const scope = await prepareApiPlugin("supbrd-plugmod-email");
	await prepareApiPlugin(plugin);
	const db = pluginDatabase("email");
	const message = await jsonResult<{ id: string }>(
		await apiCommand("supbrd-plugmod-email", "send_transactional_email", {
			method: "POST",
			path: `/api/v1/email/projects/${scope.production_project_ref}/transactional`,
			body: {
				recipient: "observability@example.test",
				subject: "Observability Email recovery",
				text: "Captured locally before queue failure",
			},
		}),
		202,
	);
	const replay = await quarantineEmailDeadLetter(db, "retirement-observability-email-dlq", {
		id: "observability-replay",
		body: { type: "email.deliver", messageId: message.id },
		attempts: 4,
	});
	const discard = await quarantineEmailDeadLetter(db, "retirement-observability-email-dlq", {
		id: "observability-discard",
		body: { type: "email.deliver", messageId: message.id },
		attempts: 4,
	});
	const operations = await jsonResult<{
		messages: Array<{ id: string; status: string }>;
		deadLetters: Array<{ id: string; resolution: string }>;
	}>(
		await apiRead(plugin, "platform_email_operations", {
			method: "GET",
			path: "/api/v1/platform/email/operations",
		}),
	);
	expect(operations.messages).toContainEqual(
		expect.objectContaining({ id: message.id, status: "failed" }),
	);
	expect(operations.deadLetters.map((row) => row.id)).toEqual(
		expect.arrayContaining([replay.id, discard.id]),
	);
	proveApi(plugin, "platform_email_operations", "read", file, [message.id, replay.id, discard.id]);
	const replayResponse = await SELF.fetch(
		`https://site.example/_emdash/api/superboard/plugins/${plugin}/commands/${plugin}.command.replay_email_dead_letter`,
		{
			method: "POST",
			headers: {
				...apiHeaders,
				"X-Test-Email-Transport": "smtp",
				"Idempotency-Key": crypto.randomUUID(),
			},
			body: JSON.stringify({
				method: "POST",
				path: `/api/v1/platform/email/dead-letters/${replay.id}/replay`,
				body: {},
			}),
		},
	);
	expect(await jsonResult(replayResponse, 202)).toMatchObject({
		id: replay.id,
		status: "replayed",
		messageId: message.id,
	});
	expect(
		await db
			.prepare("SELECT resolution FROM email_dead_letters WHERE id=?")
			.bind(replay.id)
			.first(),
	).toEqual({ resolution: "replayed" });
	proveApi(plugin, "replay_email_dead_letter", "mutation", file, [replay.id]);
	const discarded = await apiCommand(plugin, "discard_email_dead_letter", {
		method: "POST",
		path: `/api/v1/platform/email/dead-letters/${discard.id}/discard`,
		body: {},
	});
	expect(await jsonResult(discarded)).toMatchObject({ id: discard.id, status: "discarded" });
	expect(
		await db
			.prepare("SELECT resolution FROM email_dead_letters WHERE id=?")
			.bind(discard.id)
			.first(),
	).toEqual({ resolution: "discarded" });
	proveApi(plugin, "discard_email_dead_letter", "mutation", file, [discard.id]);
});
