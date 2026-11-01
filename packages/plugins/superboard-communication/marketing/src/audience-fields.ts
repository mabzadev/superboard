import { registerRouter } from "@superboard/contracts/route-registry";
import { Hono } from "hono";

import { choice, isOneOf, plainText, type AudienceBindings } from "./audience-shared";
import { failure } from "./auth";
import { parseStoredJson, readJsonObject, text } from "./validation";

const FIELD_TYPES = ["text", "number", "date", "boolean", "select"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export type FieldDefinition = {
	id: string;
	key: string;
	label: string;
	field_type: FieldType;
	options: string[];
	position: number;
};

/** Keys owned by the contact record itself or by system attributes. */
const RESERVED_KEYS = new Set([
	"id",
	"email",
	"name",
	"status",
	"consent_status",
	"consent_source",
	"tags",
	"tag",
	"list",
	"lists",
	"created_at",
	"updated_at",
	"activity",
]);
const MAX_FIELD_DEFINITIONS = 50;

export const audienceFieldRoutes = registerRouter(new Hono<AudienceBindings>(), {
	service: "marketing",
	module: "audience-fields.audienceFieldRoutes",
	pluginId: "superboard-marketing",
	surface: "internal",
	access: "internal",
});

audienceFieldRoutes.get("/audience/fields", async (c) => {
	return c.json({ data: await fieldDefinitions(c.env.DB, c.get("project").projectId) });
});

audienceFieldRoutes.post("/audience/fields", async (c) => {
	const projectId = c.get("project").projectId;
	const body = await readJsonObject(c.req.raw);
	const key = fieldKey(body.key);
	const fieldType = choice(body.field_type, "field_type", FIELD_TYPES, "text");
	const options = fieldOptions(body.options, fieldType);
	const existing = await c.env.DB.prepare(
		"SELECT COUNT(*) total, SUM(key = ?) duplicate FROM subscriber_field_definitions WHERE project_id = ?",
	)
		.bind(key, projectId)
		.first<{ total: number; duplicate: number | null }>();
	if (Number(existing?.duplicate || 0) > 0)
		throw failure("field_conflict", "A field with this key already exists", 409);
	if (Number(existing?.total || 0) >= MAX_FIELD_DEFINITIONS)
		throw failure(
			"field_limit_reached",
			`A project can define at most ${MAX_FIELD_DEFINITIONS} fields`,
			409,
		);
	const id = crypto.randomUUID();
	await c.env.DB.prepare(
		`INSERT INTO subscriber_field_definitions (id, project_id, key, label, field_type, options_json, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			projectId,
			key,
			text(body.label ?? key, "label", 120),
			fieldType,
			JSON.stringify(options),
			Number(existing?.total || 0),
		)
		.run();
	return c.json({ data: await fieldDefinition(c.env.DB, projectId, id) }, 201);
});

audienceFieldRoutes.patch("/audience/fields/:fieldId", async (c) => {
	const projectId = c.get("project").projectId;
	const current = await fieldDefinition(c.env.DB, projectId, c.req.param("fieldId"));
	const body = await readJsonObject(c.req.raw);
	const position =
		body.position === undefined
			? current.position
			: Math.max(0, Math.trunc(Number(body.position) || 0));
	await c.env.DB.prepare(
		`UPDATE subscriber_field_definitions SET label = ?, options_json = ?, position = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND id = ?`,
	)
		.bind(
			body.label === undefined ? current.label : text(body.label, "label", 120),
			JSON.stringify(
				body.options === undefined
					? current.options
					: fieldOptions(body.options, current.field_type),
			),
			position,
			projectId,
			current.id,
		)
		.run();
	return c.json({ data: await fieldDefinition(c.env.DB, projectId, current.id) });
});

// Deleting a definition keeps stored values: the attribute becomes free-form again.
audienceFieldRoutes.delete("/audience/fields/:fieldId", async (c) => {
	const removed = await c.env.DB.prepare(
		"DELETE FROM subscriber_field_definitions WHERE project_id = ? AND id = ? RETURNING id",
	)
		.bind(c.get("project").projectId, c.req.param("fieldId"))
		.first();
	if (!removed) throw failure("field_not_found", "Field not found", 404);
	return c.json({ data: { deleted: true } });
});

export async function fieldDefinitions(db: D1Database, projectId: number) {
	const rows = await db
		.prepare(
			"SELECT * FROM subscriber_field_definitions WHERE project_id = ? ORDER BY position, key",
		)
		.bind(projectId)
		.all<Record<string, unknown>>();
	return rows.results.map(serializeField);
}

async function fieldDefinition(db: D1Database, projectId: number, id: string) {
	const row = await db
		.prepare("SELECT * FROM subscriber_field_definitions WHERE project_id = ? AND id = ?")
		.bind(projectId, id)
		.first<Record<string, unknown>>();
	if (!row) throw failure("field_not_found", "Field not found", 404);
	return serializeField(row);
}

function serializeField(row: Record<string, unknown>): FieldDefinition {
	return {
		id: String(row.id),
		key: String(row.key),
		label: String(row.label),
		field_type: isOneOf(row.field_type, FIELD_TYPES) ? row.field_type : "text",
		options: parseStoredJson<string[]>(row.options_json, []),
		position: Number(row.position || 0),
	};
}

function fieldKey(value: unknown) {
	const key = text(value, "key", 64).toLowerCase();
	if (!/^[a-z][a-z0-9_]{0,63}$/u.test(key))
		throw failure(
			"key_invalid",
			"key must start with a letter and contain lowercase letters, numbers or underscores",
		);
	if (RESERVED_KEYS.has(key)) throw failure("key_reserved", "This key is reserved");
	return key;
}

function fieldOptions(value: unknown, type: FieldType) {
	if (type !== "select") return [];
	if (!Array.isArray(value)) throw failure("options_invalid", "Select fields require options");
	const options = [...new Set(value.map((item) => plainText(item).trim()).filter(Boolean))];
	if (!options.length || options.length > 50 || options.some((option) => option.length > 120))
		throw failure("options_invalid", "Select fields require between 1 and 50 options");
	return options;
}

const TRUE_VALUES = new Set(["true", "1", "yes", "y", "oui", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "n", "non", "off"]);

/** Converts one raw value to the defined type, or returns an error code. */
export function coerceFieldValue(
	definition: Pick<FieldDefinition, "field_type" | "options">,
	value: unknown,
): { value: unknown } | { error: string } | { remove: true } {
	if (value === null || value === undefined || value === "") return { remove: true };
	switch (definition.field_type) {
		case "text": {
			const parsed = typeof value === "object" ? JSON.stringify(value) : plainText(value);
			return parsed.length > 1000 ? { error: "too_long" } : { value: parsed.trim() };
		}
		case "number": {
			const parsed =
				typeof value === "number"
					? value
					: typeof value === "object"
						? Number.NaN
						: Number(plainText(value).trim().replace(",", "."));
			return Number.isFinite(parsed) ? { value: parsed } : { error: "not_a_number" };
		}
		case "date": {
			const raw = plainText(value).trim();
			const date = /^\d{4}-\d{2}-\d{2}$/u.test(raw) ? new Date(`${raw}T00:00:00Z`) : new Date(raw);
			return Number.isNaN(date.getTime())
				? { error: "not_a_date" }
				: { value: date.toISOString().slice(0, 10) };
		}
		case "boolean": {
			if (typeof value === "boolean") return { value };
			const raw = plainText(value).trim().toLowerCase();
			if (TRUE_VALUES.has(raw)) return { value: true };
			if (FALSE_VALUES.has(raw)) return { value: false };
			return { error: "not_a_boolean" };
		}
		case "select": {
			const raw = plainText(value).trim();
			const match = definition.options.find(
				(option) => option === raw || option.toLowerCase() === raw.toLowerCase(),
			);
			return match === undefined ? { error: "not_an_option" } : { value: match };
		}
	}
}

/**
 * Validates attribute values against project field definitions. Undefined keys
 * (system attributes such as locale) pass through untouched.
 */
export function coerceAttributes(
	definitions: readonly FieldDefinition[],
	attributes: Record<string, unknown>,
) {
	const values: Record<string, unknown> = { ...attributes };
	const errors: Array<{ key: string; code: string }> = [];
	for (const definition of definitions) {
		if (!Object.hasOwn(attributes, definition.key)) continue;
		const result = coerceFieldValue(definition, attributes[definition.key]);
		if ("error" in result) errors.push({ key: definition.key, code: result.error });
		else if ("remove" in result) delete values[definition.key];
		else values[definition.key] = result.value;
	}
	return { values, errors };
}

/** Throwing variant for API writes. */
export async function validateAttributes(
	db: D1Database,
	projectId: number,
	attributes: Record<string, unknown>,
) {
	if (!Object.keys(attributes).length) return attributes;
	const { values, errors } = coerceAttributes(await fieldDefinitions(db, projectId), attributes);
	if (errors.length)
		throw failure(
			"attributes_invalid",
			`Invalid value for ${errors[0]?.key ?? "attributes"}`,
			422,
			{
				fields: errors,
			},
		);
	return values;
}
