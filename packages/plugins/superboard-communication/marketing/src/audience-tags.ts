import { registerRouter } from "@superboard/contracts/route-registry";
import { Hono } from "hono";

import {
	choice,
	chunks,
	D1_PARAMETER_CHUNK,
	runBatches,
	type AudienceBindings,
} from "./audience-shared";
import { failure } from "./auth";
import { optionalText, readJsonObject, stringArray, text } from "./validation";

const MAX_TAGS_PER_PROJECT = 500;
const MAX_BULK_SUBSCRIBERS = 1000;

export const audienceTagRoutes = registerRouter(new Hono<AudienceBindings>(), {
	service: "marketing",
	module: "audience-tags.audienceTagRoutes",
	pluginId: "superboard-marketing",
	surface: "internal",
	access: "internal",
});

audienceTagRoutes.get("/audience/tags", async (c) => {
	const rows = await c.env.DB.prepare(
		`SELECT tag.id, tag.name, tag.color, tag.created_at, tag.updated_at,
       (SELECT COUNT(*) FROM subscriber_tag_assignments assignment
         WHERE assignment.project_id = tag.project_id AND assignment.tag_id = tag.id) subscriber_count
     FROM subscriber_tags tag WHERE tag.project_id = ? ORDER BY tag.name COLLATE NOCASE`,
	)
		.bind(c.get("project").projectId)
		.all();
	return c.json({ data: rows.results });
});

audienceTagRoutes.post("/audience/tags", async (c) => {
	const projectId = c.get("project").projectId;
	const body = await readJsonObject(c.req.raw);
	const name = tagName(body.name);
	const existing = await c.env.DB.prepare(
		"SELECT id FROM subscriber_tags WHERE project_id = ? AND name = ? COLLATE NOCASE",
	)
		.bind(projectId, name)
		.first();
	if (existing) throw failure("tag_conflict", "A tag with this name already exists", 409);
	await ensureTagCapacity(c.env.DB, projectId, 1);
	const id = crypto.randomUUID();
	await c.env.DB.prepare(
		"INSERT INTO subscriber_tags (id, project_id, name, color) VALUES (?, ?, ?, ?)",
	)
		.bind(id, projectId, name, tagColor(body.color))
		.run();
	return c.json({ data: await tag(c.env.DB, projectId, id) }, 201);
});

audienceTagRoutes.patch("/audience/tags/:tagId", async (c) => {
	const projectId = c.get("project").projectId;
	const current = await tag(c.env.DB, projectId, c.req.param("tagId"));
	const body = await readJsonObject(c.req.raw);
	const name = body.name === undefined ? String(current.name) : tagName(body.name);
	const conflict = await c.env.DB.prepare(
		"SELECT id FROM subscriber_tags WHERE project_id = ? AND name = ? COLLATE NOCASE AND id != ?",
	)
		.bind(projectId, name, current.id)
		.first();
	if (conflict) throw failure("tag_conflict", "A tag with this name already exists", 409);
	await c.env.DB.prepare(
		`UPDATE subscriber_tags SET name = ?, color = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE project_id = ? AND id = ?`,
	)
		.bind(
			name,
			body.color === undefined ? current.color : tagColor(body.color),
			projectId,
			current.id,
		)
		.run();
	return c.json({ data: await tag(c.env.DB, projectId, String(current.id)) });
});

audienceTagRoutes.delete("/audience/tags/:tagId", async (c) => {
	const removed = await c.env.DB.prepare(
		"DELETE FROM subscriber_tags WHERE project_id = ? AND id = ? RETURNING id",
	)
		.bind(c.get("project").projectId, c.req.param("tagId"))
		.first();
	if (!removed) throw failure("tag_not_found", "Tag not found", 404);
	return c.json({ data: { deleted: true } });
});

/**
 * Adds or removes tags on many contacts at once. Unknown tag names are created
 * on "add" so operators can tag a selection without visiting tag management.
 */
audienceTagRoutes.post("/audience/tags/assign", async (c) => {
	const projectId = c.get("project").projectId;
	const body = await readJsonObject(c.req.raw);
	const action = choice(body.action, "action", ["add", "remove"], "add");
	const subscriberIds = stringArray(body.subscriber_ids, "subscriber_ids", MAX_BULK_SUBSCRIBERS);
	if (!subscriberIds.length) throw failure("subscriber_ids_invalid", "Select at least one contact");
	const names = stringArray(body.tag_names, "tag_names", 20).map(tagName);
	const requestedIds = stringArray(body.tag_ids, "tag_ids", 20);
	const tagIds = new Set(await existingTagIds(c.env.DB, projectId, requestedIds));
	if (tagIds.size !== requestedIds.length) throw failure("tag_not_found", "Tag not found", 404);
	if (names.length) {
		const resolved =
			action === "add"
				? await ensureTags(c.env.DB, projectId, names)
				: await tagIdsByName(c.env.DB, projectId, names);
		for (const id of resolved.values()) tagIds.add(id);
	}
	if (!tagIds.size) throw failure("tag_ids_invalid", "Choose at least one tag");
	const owned = await ownedSubscriberIds(c.env.DB, projectId, subscriberIds);
	const statements = [...tagIds].flatMap((tagId) =>
		owned.map((subscriberId) =>
			action === "add"
				? c.env.DB.prepare(
						`INSERT INTO subscriber_tag_assignments (project_id, tag_id, subscriber_id) VALUES (?, ?, ?)
             ON CONFLICT(project_id, tag_id, subscriber_id) DO NOTHING`,
					).bind(projectId, tagId, subscriberId)
				: c.env.DB.prepare(
						"DELETE FROM subscriber_tag_assignments WHERE project_id = ? AND tag_id = ? AND subscriber_id = ?",
					).bind(projectId, tagId, subscriberId),
		),
	);
	await runBatches(c.env.DB, statements);
	return c.json({
		data: { action, tag_ids: [...tagIds], subscribers: owned.length },
	});
});

export function tagName(value: unknown) {
	const name = text(value, "name", 64).replace(/\s+/gu, " ");
	if (/[,;]/u.test(name))
		throw failure("name_invalid", "Tag names cannot contain commas or semicolons");
	return name;
}

function tagColor(value: unknown) {
	const color = optionalText(value, "color", 9);
	if (color && !/^#[0-9a-f]{3,8}$/iu.test(color))
		throw failure("color_invalid", "color must be a hex color");
	return color;
}

async function tag(db: D1Database, projectId: number, id: string) {
	const row = await db
		.prepare(
			"SELECT id, name, color, created_at, updated_at FROM subscriber_tags WHERE project_id = ? AND id = ?",
		)
		.bind(projectId, id)
		.first<Record<string, unknown>>();
	if (!row) throw failure("tag_not_found", "Tag not found", 404);
	return row;
}

async function ensureTagCapacity(db: D1Database, projectId: number, adding: number) {
	const count = await db
		.prepare("SELECT COUNT(*) total FROM subscriber_tags WHERE project_id = ?")
		.bind(projectId)
		.first<{ total: number }>();
	if (Number(count?.total || 0) + adding > MAX_TAGS_PER_PROJECT)
		throw failure(
			"tag_limit_reached",
			`A project can define at most ${MAX_TAGS_PER_PROJECT} tags`,
			409,
		);
}

async function existingTagIds(db: D1Database, projectId: number, ids: string[]) {
	const found: string[] = [];
	for (const part of chunks(ids, D1_PARAMETER_CHUNK)) {
		if (!part.length) continue;
		const rows = await db
			.prepare(
				`SELECT id FROM subscriber_tags WHERE project_id = ? AND id IN (${part.map(() => "?").join(",")})`,
			)
			.bind(projectId, ...part)
			.all<{ id: string }>();
		found.push(...rows.results.map((row) => row.id));
	}
	return found;
}

/** Resolves tag names case-insensitively; returns a lowercase-name -> id map. */
async function tagIdsByName(db: D1Database, projectId: number, names: string[]) {
	const result = new Map<string, string>();
	const unique = [...new Set(names.map((name) => name.toLowerCase()))];
	for (const part of chunks(unique, D1_PARAMETER_CHUNK)) {
		if (!part.length) continue;
		const rows = await db
			.prepare(
				`SELECT id, lower(name) name FROM subscriber_tags
         WHERE project_id = ? AND lower(name) IN (${part.map(() => "?").join(",")})`,
			)
			.bind(projectId, ...part)
			.all<{ id: string; name: string }>();
		for (const row of rows.results) result.set(row.name, row.id);
	}
	return result;
}

/** Returns ids for the given names, creating missing tags. */
export async function ensureTags(db: D1Database, projectId: number, names: string[]) {
	const byName = await tagIdsByName(db, projectId, names);
	const missing = [
		...new Map(
			names
				.filter((name) => !byName.has(name.toLowerCase()))
				.map((name) => [name.toLowerCase(), name]),
		).values(),
	];
	if (missing.length) {
		await ensureTagCapacity(db, projectId, missing.length);
		await runBatches(
			db,
			missing.map((name) =>
				db
					.prepare(
						`INSERT INTO subscriber_tags (id, project_id, name) VALUES (?, ?, ?)
             ON CONFLICT(project_id, name) DO NOTHING`,
					)
					.bind(crypto.randomUUID(), projectId, name),
			),
		);
		for (const [name, id] of await tagIdsByName(db, projectId, missing)) byName.set(name, id);
	}
	return byName;
}

async function ownedSubscriberIds(db: D1Database, projectId: number, ids: string[]) {
	const owned: string[] = [];
	for (const part of chunks(ids, D1_PARAMETER_CHUNK)) {
		const rows = await db
			.prepare(
				`SELECT id FROM subscribers WHERE project_id = ? AND id IN (${part.map(() => "?").join(",")})`,
			)
			.bind(projectId, ...part)
			.all<{ id: string }>();
		owned.push(...rows.results.map((row) => row.id));
	}
	return owned;
}
