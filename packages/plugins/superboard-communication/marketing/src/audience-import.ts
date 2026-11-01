import { registerRouter } from "@superboard/contracts/route-registry";
import { Hono } from "hono";

import { coerceAttributes, fieldDefinitions } from "./audience-fields";
import {
	choice,
	chunks,
	D1_PARAMETER_CHUNK,
	isRecord,
	plainText,
	runBatches,
	type AudienceBindings,
} from "./audience-shared";
import { ensureTags, tagName } from "./audience-tags";
import { failure } from "./auth";
import { assertConsentAttestation, doubleOptInListIds, queueDoubleOptIns } from "./optin";
import { readJsonObject, stringArray } from "./validation";

const MAX_IMPORT_ROWS = 10_000;
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const MAX_REPORTED_SKIPS = 200;
const SUBSCRIBER_ROWS_PER_STATEMENT = 9;
const LINK_ROWS_PER_STATEMENT = 30;
const CONSENT_YES = new Set([
	"yes",
	"y",
	"true",
	"1",
	"oui",
	"confirmed",
	"opt-in",
	"optin",
	"subscribed",
	"granted",
]);

type ConsentMode = "confirmed" | "column" | "double_opt_in";
type SkipReason =
	| "invalid_email"
	| "duplicate"
	| "suppressed"
	| "no_consent"
	| "invalid_field"
	| "invalid_tag";
type PreparedRow = {
	line: number;
	email: string;
	name: string | null;
	attributes: Record<string, unknown>;
	tags: string[];
	consented: boolean;
};

export const audienceImportRoutes = registerRouter(new Hono<AudienceBindings>(), {
	service: "marketing",
	module: "audience-import.audienceImportRoutes",
	pluginId: "superboard-marketing",
	surface: "internal",
	access: "internal",
});

/**
 * Imports mapped CSV rows (up to 10,000 per request). The operator states how
 * consent was collected; new contacts are never confirmed silently. Existing
 * contacts get profile, tag and list updates but their consent never changes.
 */
audienceImportRoutes.post("/audience/imports", async (c) => {
	const projectId = c.get("project").projectId;
	const body = await readJsonObject(c.req.raw, MAX_IMPORT_BYTES);
	if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > MAX_IMPORT_ROWS)
		throw failure("rows_invalid", `rows must contain between 1 and ${MAX_IMPORT_ROWS} records`);
	const consent = choice<ConsentMode>(body.consent, "consent", [
		"confirmed",
		"column",
		"double_opt_in",
	]);
	if (consent !== "double_opt_in") assertConsentAttestation(body.consent_confirmed);
	const updateExisting = body.update_existing !== false;
	const listIds = stringArray(body.list_ids, "list_ids", 20);
	const ownedLists = await ownedListIds(c.env.DB, projectId, listIds);
	if (ownedLists.length !== listIds.length) throw failure("list_not_found", "List not found", 404);
	const doubleLists = await doubleOptInListIds(c.env.DB, projectId, listIds);
	const extraTags = stringArray(body.tags, "tags", 10).map(tagName);
	const definitions = await fieldDefinitions(c.env.DB, projectId);

	const skipped: Array<{ line: number; email: string; reason: SkipReason; detail?: string }> = [];
	const counts: Partial<Record<SkipReason, number>> = {};
	const skip = (line: number, email: string, reason: SkipReason, detail?: string) => {
		counts[reason] = (counts[reason] ?? 0) + 1;
		if (skipped.length < MAX_REPORTED_SKIPS)
			skipped.push({ line, email, reason, ...(detail ? { detail } : {}) });
	};

	const prepared = new Map<string, PreparedRow>();
	const inputRows: unknown[] = body.rows;
	for (const [index, value] of inputRows.entries()) {
		const item = isRecord(value) ? value : {};
		const line = Number.isSafeInteger(item.line) ? Number(item.line) : index + 1;
		const email = plainText(item.email).trim().toLowerCase();
		if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
			skip(line, email.slice(0, 320), "invalid_email");
			continue;
		}
		if (prepared.has(email)) {
			skip(line, email, "duplicate");
			continue;
		}
		const rawAttributes: Record<string, unknown> = isRecord(item.attributes)
			? { ...item.attributes }
			: {};
		if (typeof item.locale === "string" && item.locale.trim())
			rawAttributes.locale = item.locale.trim().slice(0, 35);
		const { values, errors } = coerceAttributes(definitions, rawAttributes);
		if (errors.length) {
			skip(line, email, "invalid_field", errors[0]?.key);
			continue;
		}
		if (JSON.stringify(values).length > 32_000) {
			skip(line, email, "invalid_field", "attributes");
			continue;
		}
		let tags: string[];
		try {
			const rawTags = Array.isArray(item.tags)
				? item.tags.map(String)
				: plainText(item.tags).split(/[,;|]/u);
			tags = [...new Set([...rawTags.map((tag) => tag.trim()).filter(Boolean), ...extraTags])]
				.slice(0, 20)
				.map(tagName);
		} catch {
			skip(line, email, "invalid_tag");
			continue;
		}
		const name =
			typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 255) : null;
		const consented =
			consent === "confirmed" ||
			(consent === "column" && CONSENT_YES.has(plainText(item.consent).trim().toLowerCase()));
		prepared.set(email, { line, email, name, attributes: values, tags, consented });
	}

	const rows = [...prepared.values()];
	const existing = new Map<string, string>();
	const suppressed = new Set<string>();
	for (const part of chunks(
		rows.map((row) => row.email),
		D1_PARAMETER_CHUNK,
	)) {
		const placeholders = part.map(() => "?").join(",");
		const [subscribers, suppressions] = await c.env.DB.batch<{ id?: string; email: string }>([
			c.env.DB.prepare(
				`SELECT id, email FROM subscribers WHERE project_id = ? AND email IN (${placeholders})`,
			).bind(projectId, ...part),
			c.env.DB.prepare(
				`SELECT email FROM suppressions WHERE project_id = ? AND email IN (${placeholders})`,
			).bind(projectId, ...part),
		]);
		for (const row of subscribers?.results ?? []) existing.set(row.email, String(row.id));
		for (const row of suppressions?.results ?? []) suppressed.add(row.email);
	}

	const creates: Array<PreparedRow & { id: string; pending: boolean }> = [];
	const updates: Array<PreparedRow & { id: string }> = [];
	let unchanged = 0;
	for (const row of rows) {
		const id = existing.get(row.email);
		if (id) {
			if (updateExisting) updates.push({ ...row, id });
			else unchanged++;
			continue;
		}
		if (suppressed.has(row.email)) {
			skip(row.line, row.email, "suppressed");
			continue;
		}
		if (consent === "column" && !row.consented) {
			skip(row.line, row.email, "no_consent");
			continue;
		}
		// Lists that require double opt-in always get a confirmation email for new contacts.
		const pending = consent === "double_opt_in" || doubleLists.length > 0;
		creates.push({ ...row, id: crypto.randomUUID(), pending });
	}

	const statements: D1PreparedStatement[] = [];
	for (const part of chunks(creates, SUBSCRIBER_ROWS_PER_STATEMENT)) {
		statements.push(
			c.env.DB.prepare(
				`INSERT INTO subscribers (id, project_id, email, name, status, attributes_json, consent_status,
           consent_source, consented_at, created_at, updated_at)
         VALUES ${part.map(() => "(?, ?, ?, ?, 'enabled', ?, ?, 'import', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))").join(",")}
         ON CONFLICT(project_id, email) DO NOTHING`,
			).bind(
				...part.flatMap((row) => [
					row.id,
					projectId,
					row.email,
					row.name,
					JSON.stringify(row.attributes),
					row.pending ? "pending" : "confirmed",
					row.pending ? null : new Date().toISOString(),
				]),
			),
		);
	}
	for (const part of chunks(updates, SUBSCRIBER_ROWS_PER_STATEMENT * 2)) {
		statements.push(
			c.env.DB.prepare(
				`UPDATE subscribers SET name = COALESCE(incoming.column2, subscribers.name),
           attributes_json = json_patch(subscribers.attributes_json, incoming.column3),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         FROM (VALUES ${part.map(() => "(?, ?, ?)").join(",")}) AS incoming
         WHERE subscribers.project_id = ? AND subscribers.id = incoming.column1`,
			).bind(
				...part.flatMap((row) => [row.id, row.name, JSON.stringify(row.attributes)]),
				projectId,
			),
		);
	}
	await runBatches(c.env.DB, statements);

	const touched = [...creates, ...updates];
	const tagIds = touched.some((row) => row.tags.length)
		? await ensureTags(c.env.DB, projectId, [...new Set(touched.flatMap((row) => row.tags))])
		: new Map<string, string>();
	const tagLinks = touched.flatMap((row) =>
		row.tags.flatMap((tag) => {
			const tagId = tagIds.get(tag.toLowerCase());
			return tagId ? [[tagId, row.id] as const] : [];
		}),
	);
	const listLinks = ownedLists.flatMap((listId) => touched.map((row) => [listId, row.id] as const));
	const links: D1PreparedStatement[] = [];
	for (const part of chunks(tagLinks, LINK_ROWS_PER_STATEMENT))
		links.push(
			c.env.DB.prepare(
				`INSERT INTO subscriber_tag_assignments (project_id, tag_id, subscriber_id)
         SELECT ?, link.column1, link.column2 FROM (VALUES ${part.map(() => "(?, ?)").join(",")}) AS link
         WHERE EXISTS (SELECT 1 FROM subscribers WHERE project_id = ? AND id = link.column2)
         ON CONFLICT(project_id, tag_id, subscriber_id) DO NOTHING`,
			).bind(projectId, ...part.flat(), projectId),
		);
	for (const part of chunks(listLinks, LINK_ROWS_PER_STATEMENT))
		links.push(
			c.env.DB.prepare(
				`INSERT INTO subscriber_list_memberships (project_id, list_id, subscriber_id, source)
         SELECT ?, link.column1, link.column2, 'import' FROM (VALUES ${part.map(() => "(?, ?)").join(",")}) AS link
         WHERE EXISTS (SELECT 1 FROM subscribers WHERE project_id = ? AND id = link.column2)
         ON CONFLICT(project_id, subscriber_id, list_id) DO NOTHING`,
			).bind(projectId, ...part.flat(), projectId),
		);
	await runBatches(c.env.DB, links);

	const confirmationSent = await queueDoubleOptIns(
		c.env,
		projectId,
		creates.filter((row) => row.pending).map((row) => row.id),
	);
	const skippedTotal = Object.values(counts).reduce((total, value) => total + (value ?? 0), 0);
	return c.json(
		{
			data: {
				received: body.rows.length,
				processed: creates.length + updates.length,
				created: creates.length,
				updated: updates.length,
				unchanged,
				skipped: skippedTotal,
				skipped_by_reason: counts,
				skipped_rows: skipped,
				confirmation_sent: confirmationSent,
			},
		},
		200,
	);
});

async function ownedListIds(db: D1Database, projectId: number, ids: string[]) {
	if (!ids.length) return [];
	const rows = await db
		.prepare(
			`SELECT id FROM subscriber_lists WHERE project_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
		)
		.bind(projectId, ...ids)
		.all<{ id: string }>();
	return rows.results.map((row) => row.id);
}
