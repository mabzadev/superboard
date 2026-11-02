import { sql, type Kysely } from "kysely";

import type { Database } from "../../database/types.js";
import { validateIdentifier } from "../../database/validate.js";
import { SchemaRegistry } from "../../schema/registry.js";
import type { Field } from "../../schema/types.js";
import { generateZodSchema } from "../../schema/zod-generator.js";
import { chunks, SQL_BATCH_SIZE } from "../../utils/chunks.js";
import { isMissingTableError } from "../../utils/db-errors.js";

type ValidationResult =
	| { ok: true }
	| { ok: false; error: { code: "VALIDATION_ERROR" | "COLLECTION_NOT_FOUND"; message: string } };

function isMissing(value: unknown): boolean {
	return value === undefined || value === null || value === "";
}

function getReferenceTargetCollection(field: Field): string | undefined {
	const fromOptions = field.options?.collection;
	if (typeof fromOptions === "string" && fromOptions.length > 0) return fromOptions;
	const validation = field.validation;
	if (validation && "collection" in validation) {
		const fromValidation: unknown = (validation as { collection?: unknown }).collection;
		if (typeof fromValidation === "string" && fromValidation.length > 0) return fromValidation;
	}
	return undefined;
}

function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
	if (path.length === 0) return "(root)";
	return path.map((seg) => String(seg)).join(".");
}

export async function validateContentData(
	db: Kysely<Database>,
	collection: string,
	data: Record<string, unknown>,
	options: { partial?: boolean } = {},
): Promise<ValidationResult> {
	const registry = new SchemaRegistry(db);
	const collectionWithFields = await registry.getCollectionWithFields(collection);
	if (!collectionWithFields) {
		return {
			ok: false,
			error: {
				code: "COLLECTION_NOT_FOUND",
				message: `Collection '${collection}' not found`,
			},
		};
	}

	const issues: string[] = [];

	const knownFields = new Set(collectionWithFields.fields.map((f) => f.slug));
	for (const key of Object.keys(data)) {
		if (key.startsWith("_")) continue;
		if (!knownFields.has(key)) {
			issues.push(`${key}: unknown field on collection '${collection}'`);
		}
	}

	const baseSchema = generateZodSchema(collectionWithFields);
	const schema = options.partial ? baseSchema.partial() : baseSchema;
	const parsed = schema.safeParse(data);
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			issues.push(`${formatIssuePath(issue.path)}: ${issue.message}`);
		}
	}

	for (const field of collectionWithFields.fields) {
		if (!field.required) continue;
		const present = Object.hasOwn(data, field.slug);
		if (options.partial && !present) continue;
		if (data[field.slug] === "") {
			issues.push(`${field.slug}: required (empty value not allowed)`);
		}
	}

	const refsByTarget = new Map<string, { field: string; id: string }[]>();
	for (const field of collectionWithFields.fields) {
		if (field.type !== "reference") continue;
		if (options.partial && !Object.hasOwn(data, field.slug)) continue;
		const value = data[field.slug];
		if (isMissing(value)) continue;
		if (typeof value !== "string") continue;
		const target = getReferenceTargetCollection(field);
		if (!target) continue;
		const list = refsByTarget.get(target) ?? [];
		list.push({ field: field.slug, id: value });
		refsByTarget.set(target, list);
	}

	for (const [target, refs] of refsByTarget) {
		try {
			validateIdentifier(target, "reference target collection");
		} catch {
			for (const ref of refs) {
				issues.push(`${ref.field}: invalid reference target collection '${target}'`);
			}
			continue;
		}

		const ids = [...new Set(refs.map((r) => r.id))];
		const tableName = `ec_${target}`;

		const found = new Set<string>();
		let targetTableMissing = false;
		for (const idChunk of chunks(ids, SQL_BATCH_SIZE)) {
			try {
				const rows = await sql<{ id: string }>`
					SELECT id FROM ${sql.ref(tableName)}
					WHERE id IN (${sql.join(idChunk)})
					AND deleted_at IS NULL
				`.execute(db);
				for (const row of rows.rows) {
					found.add(row.id);
				}
			} catch (error) {
				if (isMissingTableError(error)) {
					targetTableMissing = true;
					break;
				}
				throw error;
			}
		}
		if (targetTableMissing) {
			for (const ref of refs) {
				issues.push(`${ref.field}: target '${ref.id}' not found in collection '${target}'`);
			}
			continue;
		}
		for (const ref of refs) {
			if (!found.has(ref.id)) {
				issues.push(`${ref.field}: target '${ref.id}' not found in collection '${target}'`);
			}
		}
	}

	if (issues.length === 0) return { ok: true };
	return {
		ok: false,
		error: {
			code: "VALIDATION_ERROR",
			message: issues.join("; "),
		},
	};
}
