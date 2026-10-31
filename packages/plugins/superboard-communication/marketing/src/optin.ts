import { registerRouter } from "@superboard/contracts/route-registry";
import { Hono } from "hono";

import {
	chunks,
	D1_PARAMETER_CHUNK,
	escapeHtml,
	isFrench,
	randomUrlToken,
	runBatches,
	type AudienceBindings,
} from "./audience-shared";
import { failure } from "./auth";
import { encryptJson, sha256 } from "./secrets";
import type { Env, MarketingQueueJob } from "./types";
import { jsonObject, optionalText, parseStoredJson, readJsonObject } from "./validation";

type DoubleOptInCopy = {
	subject: string;
	heading: string;
	body: string;
	button_label: string;
};
type DoubleOptInSettings = { en: DoubleOptInCopy; fr: DoubleOptInCopy };

/** Defaults reproduce the historical hard-coded confirmation email exactly. */
const DEFAULT_DOUBLE_OPTIN: DoubleOptInSettings = {
	en: {
		subject: "Confirm your subscription",
		heading: "Confirm your subscription",
		body: "",
		button_label: "Confirm subscription",
	},
	fr: {
		subject: "Confirmez votre inscription",
		heading: "Confirmez votre inscription",
		body: "",
		button_label: "Confirmer l’inscription",
	},
};
const LIMITS: Record<keyof DoubleOptInCopy, number> = {
	subject: 200,
	heading: 200,
	body: 2000,
	button_label: 60,
};
const COPY_KEYS: ReadonlyArray<keyof DoubleOptInCopy> = [
	"subject",
	"heading",
	"body",
	"button_label",
];
const OPTIN_TTL_MS = 48 * 60 * 60 * 1000;
const UPDATE_ROWS_PER_STATEMENT = Math.floor(D1_PARAMETER_CHUNK / 3);
const OUTBOX_ROWS_PER_STATEMENT = Math.floor(D1_PARAMETER_CHUNK / 4);

export const doubleOptInRoutes = registerRouter(new Hono<AudienceBindings>(), {
	service: "marketing",
	module: "optin.doubleOptInRoutes",
	pluginId: "superboard-marketing",
	surface: "internal",
	access: "internal",
});

doubleOptInRoutes.get("/audience/double-opt-in", async (c) => {
	const stored = await storedSettings(c.env.DB, c.get("project").projectId);
	return c.json({
		data: {
			...mergeSettings(stored),
			customized: Object.keys(stored).length > 0,
			defaults: DEFAULT_DOUBLE_OPTIN,
		},
	});
});

doubleOptInRoutes.put("/audience/double-opt-in", async (c) => {
	const projectId = c.get("project").projectId;
	const body = await readJsonObject(c.req.raw);
	const stored: Partial<Record<"en" | "fr", Partial<DoubleOptInCopy>>> = {};
	for (const locale of ["en", "fr"] as const) {
		const source = jsonObject(body[locale], locale, 8_000);
		const copy: Partial<DoubleOptInCopy> = {};
		for (const key of COPY_KEYS) {
			const value = optionalText(source[key], `${locale}.${key}`, LIMITS[key]);
			if (value && value !== DEFAULT_DOUBLE_OPTIN[locale][key]) copy[key] = value;
		}
		if (Object.keys(copy).length) stored[locale] = copy;
	}
	await c.env.DB.prepare(
		`INSERT INTO marketing_audience_settings (project_id, double_optin_json, updated_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(project_id) DO UPDATE SET double_optin_json = excluded.double_optin_json, updated_at = excluded.updated_at`,
	)
		.bind(projectId, JSON.stringify(stored))
		.run();
	return c.json({
		data: {
			...mergeSettings(stored),
			customized: Object.keys(stored).length > 0,
			defaults: DEFAULT_DOUBLE_OPTIN,
		},
	});
});

async function storedSettings(db: D1Database, projectId: number) {
	const row = await db
		.prepare("SELECT double_optin_json FROM marketing_audience_settings WHERE project_id = ?")
		.bind(projectId)
		.first<{ double_optin_json: string }>();
	return parseStoredJson<Partial<Record<"en" | "fr", Partial<DoubleOptInCopy>>>>(
		row?.double_optin_json,
		{},
	);
}

function mergeSettings(
	stored: Partial<Record<"en" | "fr", Partial<DoubleOptInCopy>>>,
): DoubleOptInSettings {
	return {
		en: { ...DEFAULT_DOUBLE_OPTIN.en, ...stored.en },
		fr: { ...DEFAULT_DOUBLE_OPTIN.fr, ...stored.fr },
	};
}

/** Builds the confirmation message for one recipient in their language. */
export async function renderDoubleOptInMessage(
	db: D1Database,
	projectId: number,
	recipient: { name: string | null; locale: unknown },
	confirmationUrl: string,
) {
	const copy = mergeSettings(await storedSettings(db, projectId))[
		isFrench(recipient.locale) ? "fr" : "en"
	];
	const fill = (value: string, escape: boolean) =>
		(escape ? escapeHtml(value) : value).replace(/\{\{\s*name\s*\}\}/gu, () =>
			escape ? escapeHtml(recipient.name ?? "") : (recipient.name ?? ""),
		);
	const heading = fill(copy.heading, true);
	const body = fill(copy.body, true);
	const plainBody = fill(copy.body, false);
	const href = escapeHtml(confirmationUrl);
	return {
		subject: fill(copy.subject, false),
		text: `${fill(copy.heading, false)}: ${confirmationUrl}${plainBody ? `\n\n${plainBody}` : ""}`,
		html: `<p>${heading}</p>${body ? `<p>${body.replaceAll("\n", "<br>")}</p>` : ""}<p><a href="${href}">${escapeHtml(copy.button_label)}</a></p>`,
	};
}

/** Lists in `listIds` that require double opt-in. */
export async function doubleOptInListIds(db: D1Database, projectId: number, listIds: string[]) {
	const found: string[] = [];
	for (const part of chunks([...new Set(listIds)], D1_PARAMETER_CHUNK)) {
		if (!part.length) continue;
		const rows = await db
			.prepare(
				`SELECT id FROM subscriber_lists WHERE project_id = ? AND optin_mode = 'double'
         AND id IN (${part.map(() => "?").join(",")})`,
			)
			.bind(projectId, ...part)
			.all<{ id: string }>();
		found.push(...rows.results.map((row) => row.id));
	}
	return found;
}

/**
 * Puts the given subscribers in pending consent with a fresh confirmation token
 * and queues one confirmation email each. Blocklisted contacts are never touched.
 * Returns the number of confirmation emails queued.
 */
export async function queueDoubleOptIns(env: Env, projectId: number, subscriberIds: string[]) {
	const unique = [...new Set(subscriberIds)];
	if (!unique.length) return 0;
	const expiresAt = new Date(Date.now() + OPTIN_TTL_MS).toISOString();
	const jobs: Array<Extract<MarketingQueueJob, { type: "marketing.optin.deliver" }>> = [];
	const tokens: Array<{ subscriberId: string; hash: string; outboxId: string; payload: string }> =
		[];
	for (const subscriberId of unique) {
		const token = randomUrlToken();
		const outboxId = crypto.randomUUID();
		tokens.push({
			subscriberId,
			hash: await sha256(token),
			outboxId,
			payload: await encryptJson(env.SMTP_ENCRYPTION_KEY, { token }),
		});
		jobs.push({ type: "marketing.optin.deliver", projectId, subscriberId, token, outboxId });
	}
	const statements: D1PreparedStatement[] = [];
	for (const part of chunks(tokens, UPDATE_ROWS_PER_STATEMENT)) {
		statements.push(
			env.DB.prepare(
				`UPDATE subscribers SET consent_status = 'pending', optin_token_hash = pending.column2,
           optin_token_expires_at = pending.column3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         FROM (VALUES ${part.map(() => "(?, ?, ?)").join(",")}) AS pending
         WHERE subscribers.project_id = ? AND subscribers.id = pending.column1
           AND subscribers.status != 'blocklisted'`,
			).bind(...part.flatMap((item) => [item.subscriberId, item.hash, expiresAt]), projectId),
		);
	}
	for (const part of chunks(tokens, OUTBOX_ROWS_PER_STATEMENT)) {
		statements.push(
			env.DB.prepare(
				`INSERT INTO marketing_outbox (id, project_id, job_type, resource_id, encrypted_payload)
         VALUES ${part.map(() => "(?, ?, 'double_optin', ?, ?)").join(",")}
         ON CONFLICT(project_id, job_type, resource_id) DO UPDATE SET id = excluded.id,
           encrypted_payload = excluded.encrypted_payload, status = 'pending', attempt_count = 0,
           last_error = NULL, dispatched_at = NULL, completed_at = NULL,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
			).bind(
				...part.flatMap((item) => [item.outboxId, projectId, item.subscriberId, item.payload]),
			),
		);
	}
	await runBatches(env.DB, statements);
	// Delivery is best effort here: pending outbox rows are retried by the scheduled job.
	for (const part of chunks(jobs, 100)) {
		try {
			await env.MARKETING_QUEUE.sendBatch(part.map((body) => ({ body })));
			await runBatches(
				env.DB,
				chunks(part, D1_PARAMETER_CHUNK - 1).map((group) =>
					env.DB.prepare(
						`UPDATE marketing_outbox SET status = 'dispatched', attempt_count = attempt_count + 1,
               dispatched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE project_id = ? AND id IN (${group.map(() => "?").join(",")})`,
					).bind(projectId, ...group.map((job) => job.outboxId)),
				),
			);
		} catch (error) {
			console.error(
				JSON.stringify({
					event: "marketing_optin_dispatch_deferred",
					project_id: projectId,
					count: part.length,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		}
	}
	return jobs.length;
}

export function assertConsentAttestation(value: unknown) {
	if (value !== true)
		throw failure(
			"consent_confirmation_required",
			"Confirm that every imported contact agreed to receive your emails",
		);
}
