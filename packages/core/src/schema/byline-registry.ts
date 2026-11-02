import type { Kysely } from "kysely";
import { sql } from "kysely";
import { ulid } from "ulidx";

import { withTransaction } from "../database/transaction.js";
import type { BylineFieldTable, Database } from "../database/types.js";
import { validateIdentifier } from "../database/validate.js";
import {
	BYLINE_FIELD_TYPES,
	RESERVED_BYLINE_FIELD_SLUGS,
	type BylineFieldDefinition,
	type BylineFieldType,
	type BylineFieldValidation,
	type CreateBylineFieldInput,
	type UpdateBylineFieldInput,
} from "./types.js";

const RESERVED_SET: ReadonlySet<string> = new Set(RESERVED_BYLINE_FIELD_SLUGS);
const TYPE_SET: ReadonlySet<string> = new Set(BYLINE_FIELD_TYPES);

const VERSION_KEY = "byline_fields_version";

const MAX_SELECT_OPTIONS = 200;
const MAX_SLUG_LENGTH = 63;
const MAX_LABEL_LENGTH = 200;

export class BylineSchemaError extends Error {
	constructor(
		message: string,
		public code: string,
		public details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "BylineSchemaError";
	}
}

export function mapBylineSchemaError(error: BylineSchemaError): {
	code: string;
	message: string;
	details?: Record<string, unknown>;
} {
	switch (error.code) {
		case "FIELD_NOT_FOUND":
			return { code: "NOT_FOUND", message: error.message, details: error.details };
		case "FIELD_EXISTS":
		case "TRANSLATABLE_LOCKED":
		case "REORDER_MISMATCH":
		case "INVALID_SLUG":
		case "RESERVED_SLUG":
		case "INVALID_TYPE":
			return { code: error.code, message: error.message, details: error.details };
		default:
			return { code: "VALIDATION_ERROR", message: error.message, details: error.details };
	}
}

export class BylineSchemaRegistry {
	constructor(private db: Kysely<Database>) {}

	async listFields(): Promise<BylineFieldDefinition[]> {
		const rows = await this.db
			.selectFrom("_emdash_byline_fields")
			.selectAll()
			.orderBy("sort_order", "asc")
			.orderBy("created_at", "asc")
			.execute();
		return rows.map((row) => mapFieldRow(row));
	}

	async getField(slug: string): Promise<BylineFieldDefinition | null> {
		const row = await this.db
			.selectFrom("_emdash_byline_fields")
			.selectAll()
			.where("slug", "=", slug)
			.executeTakeFirst();
		return row ? mapFieldRow(row) : null;
	}

	async getFieldById(id: string): Promise<BylineFieldDefinition | null> {
		const row = await this.db
			.selectFrom("_emdash_byline_fields")
			.selectAll()
			.where("id", "=", id)
			.executeTakeFirst();
		return row ? mapFieldRow(row) : null;
	}

	async createField(input: CreateBylineFieldInput): Promise<BylineFieldDefinition> {
		this.validateSlug(input.slug);
		this.validateLabel(input.label);
		this.validateType(input.type);
		const validation = this.normaliseValidation(input.type, input.validation ?? null);

		const existing = await this.getField(input.slug);
		if (existing) {
			await this.markVersionClean();
			throw new BylineSchemaError(`Byline field "${input.slug}" already exists`, "FIELD_EXISTS", {
				slug: input.slug,
			});
		}

		const id = ulid();
		const sortOrder = input.sortOrder ?? (await this.nextSortOrder());

		await this.markVersionDirty();
		await withTransaction(this.db, async (trx) => {
			await trx
				.insertInto("_emdash_byline_fields")
				.values({
					id,
					slug: input.slug,
					label: input.label,
					type: input.type,
					required: input.required ? 1 : 0,
					translatable: input.translatable === false ? 0 : 1,
					validation: validation ? JSON.stringify(validation) : null,
					sort_order: sortOrder,
				})
				.execute();
		});
		await this.markVersionClean();

		const created = await this.getFieldById(id);
		if (!created) {
			throw new BylineSchemaError("Failed to load created field", "FIELD_NOT_FOUND", {
				id,
			});
		}
		return created;
	}

	async updateField(slug: string, input: UpdateBylineFieldInput): Promise<BylineFieldDefinition> {
		const field = await this.getField(slug);
		if (!field) {
			await this.markVersionClean();
			throw new BylineSchemaError(`Byline field "${slug}" not found`, "FIELD_NOT_FOUND", {
				slug,
			});
		}

		const updates: Partial<{
			label: string;
			required: number;
			translatable: number;
			validation: string | null;
			sort_order: number;
			updated_at: string;
		}> = {};

		if (input.label !== undefined) {
			this.validateLabel(input.label);
			updates.label = input.label;
		}

		if (input.required !== undefined) {
			updates.required = input.required ? 1 : 0;
		}

		if (input.validation !== undefined) {
			const validation = this.normaliseValidation(field.type, input.validation);
			updates.validation = validation ? JSON.stringify(validation) : null;
		}

		if (input.translatable !== undefined && input.translatable !== field.translatable) {
			const usage = await this.countFieldValues(field.id);
			if (usage > 0) {
				throw new BylineSchemaError(
					`Cannot change "translatable" on field "${slug}" while ${usage} value row(s) exist. ` +
						`Delete the values (or the field) and re-create with the new setting.`,
					"TRANSLATABLE_LOCKED",
					{ slug, valueCount: usage },
				);
			}
			updates.translatable = input.translatable ? 1 : 0;
		}

		if (input.sortOrder !== undefined) {
			updates.sort_order = input.sortOrder;
		}

		if (Object.keys(updates).length === 0) {
			await this.markVersionClean();
			return field;
		}

		updates.updated_at = new Date().toISOString();

		await this.markVersionDirty();
		await withTransaction(this.db, async (trx) => {
			await trx
				.updateTable("_emdash_byline_fields")
				.set(updates)
				.where("id", "=", field.id)
				.execute();
		});
		await this.markVersionClean();

		const updated = await this.getFieldById(field.id);
		if (!updated) {
			throw new BylineSchemaError("Failed to load updated field", "FIELD_NOT_FOUND", {
				slug,
			});
		}
		return updated;
	}

	async deleteField(slug: string): Promise<void> {
		const field = await this.getField(slug);
		if (!field) {
			await this.markVersionClean();
			throw new BylineSchemaError(`Byline field "${slug}" not found`, "FIELD_NOT_FOUND", {
				slug,
			});
		}

		await this.markVersionDirty();
		await withTransaction(this.db, async (trx) => {
			await trx
				.deleteFrom("_emdash_byline_field_values")
				.where("field_id", "=", field.id)
				.execute();
			await trx
				.deleteFrom("_emdash_byline_field_group_values")
				.where("field_id", "=", field.id)
				.execute();
			await trx.deleteFrom("_emdash_byline_fields").where("id", "=", field.id).execute();
		});
		await this.markVersionClean();
	}

	async reorderFields(slugs: string[]): Promise<void> {
		if (new Set(slugs).size !== slugs.length) {
			throw new BylineSchemaError("Reorder input contains duplicate slugs", "REORDER_MISMATCH", {
				slugs,
			});
		}

		const registered = await this.listFields();
		const registeredSlugs = registered.map((f) => f.slug).toSorted();
		const inputSlugs = slugs.toSorted();

		if (registeredSlugs.length !== inputSlugs.length) {
			throw new BylineSchemaError(
				`Reorder input has ${inputSlugs.length} slug(s); ${registeredSlugs.length} registered`,
				"REORDER_MISMATCH",
				{ registered: registeredSlugs, input: inputSlugs },
			);
		}
		for (let i = 0; i < registeredSlugs.length; i++) {
			if (registeredSlugs[i] !== inputSlugs[i]) {
				throw new BylineSchemaError(
					"Reorder input does not match the registered field set",
					"REORDER_MISMATCH",
					{ registered: registeredSlugs, input: inputSlugs },
				);
			}
		}

		const now = new Date().toISOString();
		await this.markVersionDirty();
		await withTransaction(this.db, async (trx) => {
			for (let i = 0; i < slugs.length; i++) {
				const slug = slugs[i];
				if (slug === undefined) continue;
				await trx
					.updateTable("_emdash_byline_fields")
					.set({ sort_order: i, updated_at: now })
					.where("slug", "=", slug)
					.execute();
			}
		});
		await this.markVersionClean();
	}

	async getFieldUsage(slug: string): Promise<{
		translatableValueCount: number;
		groupValueCount: number;
		totalAffectedRows: number;
	}> {
		const field = await this.getField(slug);
		if (!field) {
			throw new BylineSchemaError(`Byline field "${slug}" not found`, "FIELD_NOT_FOUND", {
				slug,
			});
		}
		const tr = await this.db
			.selectFrom("_emdash_byline_field_values")
			.select(({ fn }) => [fn.count<number>("field_id").as("count")])
			.where("field_id", "=", field.id)
			.executeTakeFirst();
		const grp = await this.db
			.selectFrom("_emdash_byline_field_group_values")
			.select(({ fn }) => [fn.count<number>("field_id").as("count")])
			.where("field_id", "=", field.id)
			.executeTakeFirst();
		const translatableValueCount = Number(tr?.count ?? 0);
		const groupValueCount = Number(grp?.count ?? 0);
		return {
			translatableValueCount,
			groupValueCount,
			totalAffectedRows: translatableValueCount + groupValueCount,
		};
	}

	async getVersion(): Promise<number> {
		const row = await this.db
			.selectFrom("options")
			.select("value")
			.where("name", "=", VERSION_KEY)
			.executeTakeFirst();
		if (!row) return 0;
		const parsed = Number.parseInt(row.value, 10);
		return Number.isFinite(parsed) ? parsed : 0;
	}

	private async markVersionDirty(): Promise<void> {
		await sql`
			INSERT INTO options (name, value)
			VALUES (${VERSION_KEY}, '1')
			ON CONFLICT(name) DO UPDATE SET value = CASE
				WHEN CAST(options.value AS INTEGER) % 2 = 0
					THEN CAST(CAST(options.value AS INTEGER) + 1 AS TEXT)
				ELSE options.value
			END
		`.execute(this.db);
	}

	private async markVersionClean(): Promise<void> {
		await sql`
			INSERT INTO options (name, value)
			VALUES (${VERSION_KEY}, '2')
			ON CONFLICT(name) DO UPDATE SET value = CASE
				WHEN CAST(options.value AS INTEGER) % 2 = 0
					THEN CAST(CAST(options.value AS INTEGER) + 2 AS TEXT)
				ELSE CAST(CAST(options.value AS INTEGER) + 1 AS TEXT)
			END
		`.execute(this.db);
	}

	private async nextSortOrder(): Promise<number> {
		const row = await this.db
			.selectFrom("_emdash_byline_fields")
			.select(({ fn }) => [fn.max<number | null>("sort_order").as("max")])
			.executeTakeFirst();
		const max = row?.max ?? null;
		return max === null ? 0 : max + 1;
	}

	private async countFieldValues(fieldId: string): Promise<number> {
		const tr = await this.db
			.selectFrom("_emdash_byline_field_values")
			.select(({ fn }) => [fn.count<number>("field_id").as("count")])
			.where("field_id", "=", fieldId)
			.executeTakeFirst();
		const grp = await this.db
			.selectFrom("_emdash_byline_field_group_values")
			.select(({ fn }) => [fn.count<number>("field_id").as("count")])
			.where("field_id", "=", fieldId)
			.executeTakeFirst();
		return Number(tr?.count ?? 0) + Number(grp?.count ?? 0);
	}

	private validateSlug(slug: string): void {
		if (!slug || typeof slug !== "string") {
			throw new BylineSchemaError("Byline field slug is required", "INVALID_SLUG", { slug });
		}
		if (slug.length > MAX_SLUG_LENGTH) {
			throw new BylineSchemaError(
				`Byline field slug must be ${MAX_SLUG_LENGTH} characters or less`,
				"INVALID_SLUG",
				{ slug },
			);
		}
		try {
			validateIdentifier(slug, "byline field slug");
		} catch (error) {
			throw new BylineSchemaError(
				error instanceof Error ? error.message : "Invalid byline field slug",
				"INVALID_SLUG",
				{ slug },
			);
		}
		if (RESERVED_SET.has(slug)) {
			throw new BylineSchemaError(`Byline field slug "${slug}" is reserved`, "RESERVED_SLUG", {
				slug,
			});
		}
	}

	private validateLabel(label: string): void {
		if (!label || typeof label !== "string") {
			throw new BylineSchemaError("Byline field label is required", "INVALID_LABEL", {
				label,
			});
		}
		if (label.length > MAX_LABEL_LENGTH) {
			throw new BylineSchemaError(
				`Byline field label must be ${MAX_LABEL_LENGTH} characters or less`,
				"INVALID_LABEL",
				{ length: label.length },
			);
		}
	}

	private validateType(type: BylineFieldType): void {
		if (!TYPE_SET.has(type)) {
			throw new BylineSchemaError(
				`Byline field type "${type}" is not supported. Valid types: ${[...TYPE_SET].join(", ")}`,
				"INVALID_TYPE",
				{ type },
			);
		}
	}

	private normaliseValidation(
		type: BylineFieldType,
		validation: BylineFieldValidation | null,
	): BylineFieldValidation | null {
		if (type === "select") {
			const options = validation?.options;
			if (!Array.isArray(options) || options.length === 0) {
				throw new BylineSchemaError(
					`Byline field of type "select" requires non-empty "validation.options"`,
					"INVALID_VALIDATION",
					{ type },
				);
			}
			if (options.length > MAX_SELECT_OPTIONS) {
				throw new BylineSchemaError(
					`Byline field "select" cannot have more than ${MAX_SELECT_OPTIONS} options`,
					"INVALID_VALIDATION",
					{ count: options.length },
				);
			}
			const seen = new Set<string>();
			for (const option of options) {
				if (typeof option !== "string" || option.length === 0) {
					throw new BylineSchemaError(
						`Byline field "select" options must be non-empty strings`,
						"INVALID_VALIDATION",
						{ option },
					);
				}
				if (seen.has(option)) {
					throw new BylineSchemaError(
						`Byline field "select" options must be unique`,
						"INVALID_VALIDATION",
						{ option },
					);
				}
				seen.add(option);
			}
			return { options };
		}

		if (validation == null) return null;
		const { options: _drop, ...rest } = validation;
		return Object.keys(rest).length === 0 ? null : rest;
	}
}

function mapFieldRow(row: {
	id: string;
	slug: string;
	label: string;
	type: string;
	required: number;
	translatable: number;
	validation: string | null;
	sort_order: number;
	created_at: string;
	updated_at: string;
}): BylineFieldDefinition {
	return {
		id: row.id,
		slug: row.slug,
		label: row.label,
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- validated at write
		type: row.type as BylineFieldType,
		required: row.required === 1,
		translatable: row.translatable === 1,
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- validated at write
		validation: row.validation ? (JSON.parse(row.validation) as BylineFieldValidation) : null,
		sortOrder: row.sort_order,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export type { BylineFieldTable };
