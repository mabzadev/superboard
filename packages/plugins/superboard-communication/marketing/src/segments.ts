import type { Hono } from "hono";

import {
	choice,
	D1_BATCH_SIZE,
	chunks,
	isOneOf,
	plainText,
	type AudienceBindings,
} from "./audience-shared";
import { failure } from "./auth";
import { jsonObject, parseStoredJson, readJsonObject, text } from "./validation";

const PROFILE_OPERATORS = [
	"equals",
	"not_equals",
	"contains",
	"starts_with",
	"exists",
	"in",
	"greater_than",
	"less_than",
] as const;
const TAG_OPERATORS = ["has", "not_has"] as const;
const LIST_OPERATORS = ["member", "not_member"] as const;
const ACTIVITY_OPERATORS = ["within_days", "not_within_days"] as const;
const ACTIVITY_FIELDS = {
	"activity.opened": ["open"],
	"activity.clicked": ["click"],
	"activity.received": ["sent", "delivered"],
} as const;
type ActivityField = keyof typeof ACTIVITY_FIELDS;

type SegmentCondition =
	| {
			field: string;
			operator: (typeof PROFILE_OPERATORS)[number];
			value?: unknown;
	  }
	| { field: "tag"; operator: (typeof TAG_OPERATORS)[number]; value: string }
	| { field: "list"; operator: (typeof LIST_OPERATORS)[number]; value: string }
	| {
			field: ActivityField;
			operator: (typeof ACTIVITY_OPERATORS)[number];
			value: number;
			campaign_id?: string | null;
	  };
type SegmentRules = {
	mode: "all" | "any";
	conditions: SegmentCondition[];
};

const EMPTY_RULES: SegmentRules = { mode: "all", conditions: [] };
const PAGE_SIZE = 500;
const MEMBERSHIP_ROWS_PER_STATEMENT = 30;
/** Cached snapshots older than this are refreshed by the scheduled job. */
const STALE_AFTER_MINUTES = 60;

function isActivityField(field: string): field is ActivityField {
	return Object.hasOwn(ACTIVITY_FIELDS, field);
}
function isTagCondition(
	condition: SegmentCondition,
): condition is Extract<SegmentCondition, { field: "tag" }> {
	return (
		condition.field === "tag" && (TAG_OPERATORS as readonly string[]).includes(condition.operator)
	);
}
function isListCondition(
	condition: SegmentCondition,
): condition is Extract<SegmentCondition, { field: "list" }> {
	return (
		condition.field === "list" && (LIST_OPERATORS as readonly string[]).includes(condition.operator)
	);
}
function isActivityCondition(
	condition: SegmentCondition,
): condition is Extract<SegmentCondition, { field: ActivityField }> {
	return isActivityField(condition.field);
}

/**
 * Segment routes stay registered on the main Marketing router so their route
 * ids (`marketing:index.app:…`) keep matching the published adapter catalog.
 */
export function mountSegmentRoutes(segmentRoutes: Hono<AudienceBindings>, prefix = "/internal/v1") {
	segmentRoutes.get(`${prefix}/segments`, async (c) => {
		const rows = await c.env.DB.prepare(
			`SELECT segment.*, (SELECT COUNT(*) FROM segment_memberships membership
       WHERE membership.project_id = segment.project_id AND membership.segment_id = segment.id) subscriber_count
     FROM subscriber_segments segment WHERE project_id = ? ORDER BY name`,
		)
			.bind(c.get("project").projectId)
			.all<Record<string, unknown>>();
		return c.json({
			data: rows.results.map((row) => ({
				...row,
				rules: parseStoredJson(row.rules_json, {}),
			})),
		});
	});

	segmentRoutes.post(`${prefix}/segments`, async (c) => {
		const projectId = c.get("project").projectId;
		const body = await readJsonObject(c.req.raw);
		const id = crypto.randomUUID();
		const name = text(body.name, "name");
		const rules = await validateSegmentRules(c.env.DB, projectId, body.rules);
		await c.env.DB.prepare(
			"INSERT INTO subscriber_segments (id, project_id, name, rules_json) VALUES (?, ?, ?, ?)",
		)
			.bind(id, projectId, name, JSON.stringify(rules))
			.run();
		const count = await refreshSegment(c.env.DB, projectId, id, rules);
		return c.json({ data: { id, name, rules, subscriber_count: count } }, 201);
	});

	segmentRoutes.patch(`${prefix}/segments/:segmentId`, async (c) => {
		const projectId = c.get("project").projectId;
		const current = await segment(c.env.DB, projectId, c.req.param("segmentId"));
		const body = await readJsonObject(c.req.raw);
		const rules =
			body.rules === undefined
				? storedRules(current.rules_json)
				: await validateSegmentRules(c.env.DB, projectId, body.rules);
		await c.env.DB.prepare(
			`UPDATE subscriber_segments SET name = ?, rules_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE project_id = ? AND id = ?`,
		)
			.bind(
				body.name === undefined ? current.name : text(body.name, "name"),
				JSON.stringify(rules),
				projectId,
				current.id,
			)
			.run();
		await refreshSegment(c.env.DB, projectId, String(current.id), rules);
		return c.json({
			data: {
				...(await segment(c.env.DB, projectId, String(current.id))),
				rules,
			},
		});
	});

	segmentRoutes.post(`${prefix}/segments/:segmentId/refresh`, async (c) => {
		const projectId = c.get("project").projectId;
		const current = await segment(c.env.DB, projectId, c.req.param("segmentId"));
		const count = await refreshSegment(
			c.env.DB,
			projectId,
			String(current.id),
			storedRules(current.rules_json),
		);
		return c.json({ data: { subscriber_count: count } });
	});

	segmentRoutes.delete(`${prefix}/segments/:segmentId`, async (c) => {
		const result = await c.env.DB.prepare(
			"DELETE FROM subscriber_segments WHERE project_id = ? AND id = ? RETURNING id",
		)
			.bind(c.get("project").projectId, c.req.param("segmentId"))
			.first();
		if (!result) throw failure("segment_not_found", "Segment not found", 404);
		return c.json({ data: { deleted: true } });
	});

	/** Counts matching contacts for unsaved rules so the editor can show a live estimate. */
	segmentRoutes.post(`${prefix}/audience/segments/preview`, async (c) => {
		const projectId = c.get("project").projectId;
		const body = await readJsonObject(c.req.raw);
		const rules = await validateSegmentRules(c.env.DB, projectId, body.rules);
		let count = 0;
		await evaluateSegment(c.env.DB, projectId, rules, async (ids) => {
			count += ids.length;
		});
		return c.json({ data: { subscriber_count: count } });
	});
}

async function segment(db: D1Database, projectId: number, id: string) {
	const row = await db
		.prepare("SELECT * FROM subscriber_segments WHERE project_id = ? AND id = ?")
		.bind(projectId, id)
		.first<Record<string, unknown>>();
	if (!row) throw failure("segment_not_found", "Segment not found", 404);
	return row;
}

function storedRules(value: unknown) {
	return parseStoredJson<SegmentRules>(value, EMPTY_RULES);
}

async function validateSegmentRules(
	db: D1Database,
	projectId: number,
	value: unknown,
): Promise<SegmentRules> {
	const source = jsonObject(value, "rules");
	const mode = choice(source.mode, "mode", ["all", "any"], "all");
	if (
		!Array.isArray(source.conditions) ||
		source.conditions.length === 0 ||
		source.conditions.length > 25
	)
		throw failure("segment_conditions_invalid", "A segment requires between 1 and 25 conditions");
	const tagIds = new Set<string>();
	const listIds = new Set<string>();
	const conditions = source.conditions.map((condition): SegmentCondition => {
		const item = jsonObject(condition, "condition", 4_000);
		const field = text(item.field, "field", 128);
		if (isActivityField(field)) {
			const days = Number(item.value);
			if (!Number.isSafeInteger(days) || days < 1 || days > 3650)
				throw failure(
					"value_invalid",
					"Activity conditions need a number of days between 1 and 3650",
				);
			const campaignId =
				typeof item.campaign_id === "string" && item.campaign_id.trim()
					? item.campaign_id.trim().slice(0, 255)
					: null;
			return {
				field,
				operator: choice(item.operator, "operator", ACTIVITY_OPERATORS, "within_days"),
				value: days,
				...(campaignId ? { campaign_id: campaignId } : {}),
			};
		}
		if (field === "tag" && isOneOf(item.operator, TAG_OPERATORS)) {
			const tagId = text(item.value, "value", 255);
			tagIds.add(tagId);
			return {
				field,
				operator: item.operator,
				value: tagId,
			};
		}
		if (field === "list" && isOneOf(item.operator, LIST_OPERATORS)) {
			const listId = text(item.value, "value", 255);
			listIds.add(listId);
			return {
				field,
				operator: item.operator,
				value: listId,
			};
		}
		return {
			field,
			operator: choice(item.operator, "operator", PROFILE_OPERATORS),
			value: item.value,
		};
	});
	await ensureOwned(
		db,
		projectId,
		"subscriber_tags",
		[...tagIds],
		"tag_not_found",
		"Tag not found",
	);
	await ensureOwned(
		db,
		projectId,
		"subscriber_lists",
		[...listIds],
		"list_not_found",
		"List not found",
	);
	return { mode, conditions };
}

async function ensureOwned(
	db: D1Database,
	projectId: number,
	table: "subscriber_tags" | "subscriber_lists",
	ids: string[],
	code: string,
	message: string,
) {
	if (!ids.length) return;
	const rows = await db
		.prepare(
			`SELECT COUNT(*) total FROM ${table} WHERE project_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
		)
		.bind(projectId, ...ids)
		.first<{ total: number }>();
	if (Number(rows?.total || 0) !== ids.length) throw failure(code, message, 404);
}

type EvaluationContext = {
	tags: Map<string, Set<string>>;
	lists: Map<string, Set<string>>;
	activity: Map<string, Set<string>>;
};

function activityKey(condition: Extract<SegmentCondition, { field: ActivityField }>) {
	return `${condition.field}:${condition.value}:${condition.campaign_id ?? ""}`;
}

/** Loads relations for subscribers whose id is in (low, high]; each query is index-backed. */
async function loadContext(
	db: D1Database,
	projectId: number,
	rules: SegmentRules,
	low: string,
	high: string,
): Promise<EvaluationContext> {
	const context: EvaluationContext = {
		tags: new Map(),
		lists: new Map(),
		activity: new Map(),
	};
	const tagIds = [...new Set(rules.conditions.filter(isTagCondition).map((item) => item.value))];
	const listIds = [...new Set(rules.conditions.filter(isListCondition).map((item) => item.value))];
	const activity = new Map(
		rules.conditions.filter(isActivityCondition).map((item) => [activityKey(item), item]),
	);
	const add = (map: Map<string, Set<string>>, key: string, subscriberId: string) => {
		const set = map.get(key) ?? new Set<string>();
		set.add(subscriberId);
		map.set(key, set);
	};
	if (tagIds.length) {
		const rows = await db
			.prepare(
				`SELECT subscriber_id, tag_id FROM subscriber_tag_assignments
         WHERE project_id = ? AND subscriber_id > ? AND subscriber_id <= ?
           AND tag_id IN (${tagIds.map(() => "?").join(",")})`,
			)
			.bind(projectId, low, high, ...tagIds)
			.all<{ subscriber_id: string; tag_id: string }>();
		for (const row of rows.results) add(context.tags, row.tag_id, row.subscriber_id);
	}
	if (listIds.length) {
		const rows = await db
			.prepare(
				`SELECT subscriber_id, list_id FROM subscriber_list_memberships
         WHERE project_id = ? AND subscriber_id > ? AND subscriber_id <= ?
           AND list_id IN (${listIds.map(() => "?").join(",")})`,
			)
			.bind(projectId, low, high, ...listIds)
			.all<{ subscriber_id: string; list_id: string }>();
		for (const row of rows.results) add(context.lists, row.list_id, row.subscriber_id);
	}
	for (const [key, condition] of activity) {
		const types = ACTIVITY_FIELDS[condition.field];
		const cutoff = new Date(Date.now() - condition.value * 86_400_000).toISOString();
		// occurred_at holds both SQLite and ISO timestamps, so compare as julian days.
		const rows = await db
			.prepare(
				`SELECT DISTINCT subscriber_id FROM email_events
         WHERE project_id = ? AND event_type IN (${types.map(() => "?").join(",")})
           AND subscriber_id > ? AND subscriber_id <= ?
           AND julianday(occurred_at) >= julianday(?)
           AND (? = '' OR campaign_id = ?)`,
			)
			.bind(
				projectId,
				...types,
				low,
				high,
				cutoff,
				condition.campaign_id ?? "",
				condition.campaign_id ?? "",
			)
			.all<{ subscriber_id: string }>();
		context.activity.set(key, new Set(rows.results.map((row) => row.subscriber_id)));
	}
	return context;
}

function profileValue(row: Record<string, unknown>, field: string) {
	const values = {
		...parseStoredJson<Record<string, unknown>>(row.attributes_json, {}),
		...row,
	};
	let current: unknown = values;
	for (const key of field.split(".")) {
		if (
			!current ||
			typeof current !== "object" ||
			["__proto__", "constructor", "prototype"].includes(key)
		)
			return undefined;
		const next: unknown = Reflect.get(current, key);
		current = next;
	}
	return current;
}

/** Text used to compare segment values, as String() renders them, with missing values empty. */
function comparableText(value: unknown): string {
	if (Array.isArray(value)) return value.map((item: unknown) => comparableText(item)).join(",");
	if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
	return plainText(value);
}

function compare(actual: unknown, expected: unknown) {
	const left = Number(actual);
	const right = Number(expected);
	if (actual !== "" && expected !== "" && Number.isFinite(left) && Number.isFinite(right))
		return left - right;
	return comparableText(actual).localeCompare(comparableText(expected));
}

function conditionMatches(
	row: Record<string, unknown>,
	condition: SegmentCondition,
	context: EvaluationContext,
) {
	const id = String(row.id);
	if (isTagCondition(condition)) {
		const has = context.tags.get(condition.value)?.has(id) ?? false;
		return condition.operator === "has" ? has : !has;
	}
	if (isListCondition(condition)) {
		const member = context.lists.get(condition.value)?.has(id) ?? false;
		return condition.operator === "member" ? member : !member;
	}
	if (isActivityCondition(condition)) {
		const active = context.activity.get(activityKey(condition))?.has(id) ?? false;
		return condition.operator === "within_days" ? active : !active;
	}
	const actual = profileValue(row, condition.field);
	const expected = condition.value;
	switch (condition.operator) {
		case "exists":
			return actual !== undefined && actual !== null && actual !== "";
		case "equals":
			return comparableText(actual) === comparableText(expected);
		case "not_equals":
			return comparableText(actual) !== comparableText(expected);
		case "contains":
			return comparableText(actual).toLowerCase().includes(comparableText(expected).toLowerCase());
		case "starts_with":
			return comparableText(actual)
				.toLowerCase()
				.startsWith(comparableText(expected).toLowerCase());
		case "in":
			return Array.isArray(expected) && expected.map(String).includes(comparableText(actual));
		case "greater_than":
			return (
				actual !== undefined && actual !== null && actual !== "" && compare(actual, expected) > 0
			);
		case "less_than":
			return (
				actual !== undefined && actual !== null && actual !== "" && compare(actual, expected) < 0
			);
		default:
			return false;
	}
}

/** Streams matching subscriber ids page by page, keeping every query within D1 limits. */
async function evaluateSegment(
	db: D1Database,
	projectId: number,
	rules: SegmentRules,
	onMatch: (ids: string[]) => Promise<void>,
) {
	if (!rules.conditions.length) return;
	let cursor = "";
	while (true) {
		const rows = await db
			.prepare(
				`SELECT id, email, name, status, consent_status, consent_source, attributes_json, created_at
         FROM subscribers WHERE project_id = ? AND id > ? ORDER BY id LIMIT ${PAGE_SIZE}`,
			)
			.bind(projectId, cursor)
			.all<Record<string, unknown> & { id: string }>();
		if (!rows.results.length) break;
		const high = rows.results.at(-1)?.id ?? cursor;
		const context = await loadContext(db, projectId, rules, cursor, high);
		const matching = rows.results
			.filter((row) => {
				const results = rules.conditions.map((condition) =>
					conditionMatches(row, condition, context),
				);
				return rules.mode === "all" ? results.every(Boolean) : results.some(Boolean);
			})
			.map((row) => String(row.id));
		if (matching.length) await onMatch(matching);
		cursor = high;
		if (rows.results.length < PAGE_SIZE) break;
	}
}

/**
 * Recomputes the cached snapshot. Matches are upserted with a fresh stamp and
 * stale rows removed afterwards, so readers never observe an empty segment.
 */
async function refreshSegment(
	db: D1Database,
	projectId: number,
	segmentId: string,
	rules: SegmentRules,
) {
	const stamp = new Date().toISOString();
	let matched = 0;
	await evaluateSegment(db, projectId, rules, async (ids) => {
		matched += ids.length;
		const statements = chunks(ids, MEMBERSHIP_ROWS_PER_STATEMENT).map((part) =>
			db
				.prepare(
					`INSERT INTO segment_memberships (project_id, segment_id, subscriber_id, matched_at)
           VALUES ${part.map(() => "(?, ?, ?, ?)").join(",")}
           ON CONFLICT(project_id, segment_id, subscriber_id) DO UPDATE SET matched_at = excluded.matched_at`,
				)
				.bind(...part.flatMap((id) => [projectId, segmentId, id, stamp])),
		);
		for (const part of chunks(statements, D1_BATCH_SIZE)) await db.batch(part);
	});
	await db.batch([
		db
			.prepare(
				"DELETE FROM segment_memberships WHERE project_id = ? AND segment_id = ? AND matched_at != ?",
			)
			.bind(projectId, segmentId, stamp),
		db
			.prepare(
				`UPDATE subscriber_segments SET refreshed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND id = ?`,
			)
			.bind(projectId, segmentId),
	]);
	return matched;
}

/** Recomputes the given segments right before a send or a preflight. */
export async function refreshSegmentsByIds(
	db: D1Database,
	projectId: number,
	segmentIds: string[],
) {
	for (const segmentId of [...new Set(segmentIds)]) {
		const row = await db
			.prepare("SELECT id, rules_json FROM subscriber_segments WHERE project_id = ? AND id = ?")
			.bind(projectId, segmentId)
			.first<{ id: string; rules_json: string }>();
		if (row) await refreshSegment(db, projectId, row.id, storedRules(row.rules_json));
	}
}

/** Keeps cached counts and journey entry checks reasonably fresh between sends. */
export async function refreshStaleSegments(db: D1Database, limit = 3) {
	const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60_000).toISOString();
	const rows = await db
		.prepare(
			`SELECT id, project_id, rules_json FROM subscriber_segments
       WHERE refreshed_at IS NULL OR refreshed_at < ? ORDER BY refreshed_at LIMIT ?`,
		)
		.bind(cutoff, limit)
		.all<{ id: string; project_id: number; rules_json: string }>();
	for (const row of rows.results) {
		try {
			await refreshSegment(db, row.project_id, row.id, storedRules(row.rules_json));
		} catch (error) {
			console.error(
				JSON.stringify({
					event: "marketing_segment_refresh_failed",
					segment_id: row.id,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		}
	}
}
