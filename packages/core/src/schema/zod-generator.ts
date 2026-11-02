import { z, type ZodTypeAny } from "zod";

import { hashString } from "../utils/hash.js";
import type { CollectionWithFields, Field, FieldType, RepeaterSubField } from "./types.js";

const PASCAL_CASE_SPLIT_PATTERN = /[_\-\s]+/;

export function generateZodSchema(
	collection: CollectionWithFields,
): z.ZodObject<Record<string, ZodTypeAny>> {
	const shape: Record<string, ZodTypeAny> = {};

	for (const field of collection.fields) {
		shape[field.slug] = generateFieldSchema(field);
	}

	return z.object(shape);
}

export function generateFieldSchema(field: Field): ZodTypeAny {
	let schema = getBaseSchema(field.type, field);

	if (field.validation) {
		schema = applyValidation(schema, field);
	}

	if (!field.required) {
		schema = schema.nullish();
	}

	if (field.defaultValue !== undefined) {
		schema = schema.default(field.defaultValue);
	}

	return schema;
}

function getBaseSchema(type: FieldType, field: Pick<Field, "validation">): ZodTypeAny {
	switch (type) {
		case "url":
			return z.string().url();

		case "string":
		case "text":
		case "slug":
			return z.string();

		case "number":
			return z.number();

		case "integer":
			return z.number().int();

		case "boolean":
			return z.preprocess((v) => (v === 0 || v === 1 ? Boolean(v) : v), z.boolean());

		case "datetime":
			return z.iso.datetime({ offset: true, local: true }).or(z.iso.date());

		case "select": {
			const options = field.validation?.options;
			if (options && options.length > 0) {
				const [first, ...rest] = options;
				return z.enum([first, ...rest]);
			}
			return z.string();
		}

		case "multiSelect": {
			const multiOptions = field.validation?.options;
			if (multiOptions && multiOptions.length > 0) {
				const [first, ...rest] = multiOptions;
				return z.array(z.enum([first, ...rest]));
			}
			return z.array(z.string());
		}

		case "repeater":
			return z.array(generateRepeaterRowSchema(field.validation?.subFields ?? []));

		case "portableText":
			return z.array(
				z
					.object({
						_type: z.string(),
						_key: z.string().optional(),
					})
					.passthrough(),
			);

		case "image":
			return z.object({
				id: z.string(),
				src: z.string().optional(),
				alt: z.string().optional(),
				width: z.number().optional(),
				height: z.number().optional(),
				filename: z.string().optional(),
				mimeType: z.string().optional(),
				blurhash: z.string().optional(),
				dominantColor: z.string().optional(),
				provider: z.string().optional(),
				previewUrl: z.string().optional(),
				meta: z.record(z.string(), z.unknown()).optional(),
			});

		case "file":
			return z.object({
				id: z.string(),
				url: z.string().optional(),
				src: z.string().optional(),
				filename: z.string().optional(),
				mimeType: z.string().optional(),
				size: z.number().optional(),
				provider: z.string().optional(),
				meta: z.record(z.string(), z.unknown()).optional(),
			});

		case "reference":
			return z.string();

		case "json":
			return z.unknown();

		default:
			return z.unknown();
	}
}

function generateRepeaterRowSchema(
	subFields: readonly RepeaterSubField[],
): z.ZodObject<Record<string, ZodTypeAny>> {
	const shape: Record<string, ZodTypeAny> = {};

	for (const subField of subFields) {
		let schema = getBaseSchema(subField.type, {
			validation: subField.options ? { options: subField.options } : undefined,
		});

		if (subField.required && schema instanceof z.ZodString) {
			schema = schema.min(1, "required (empty value not allowed)");
		}
		if (!subField.required) {
			schema = schema.nullish();
		}

		shape[subField.slug] = schema;
	}

	return z.object(shape).passthrough();
}

function applyValidation(schema: ZodTypeAny, field: Field): ZodTypeAny {
	const validation = field.validation;
	if (!validation) return schema;

	if (schema instanceof z.ZodString) {
		let strSchema = schema;
		if (validation.minLength !== undefined) {
			strSchema = strSchema.min(validation.minLength);
		}
		if (validation.maxLength !== undefined) {
			strSchema = strSchema.max(validation.maxLength);
		}
		if (validation.pattern) {
			strSchema = strSchema.regex(new RegExp(validation.pattern));
		}
		return strSchema;
	}

	if (schema instanceof z.ZodNumber) {
		let numSchema = schema;
		if (validation.min !== undefined) {
			numSchema = numSchema.min(validation.min);
		}
		if (validation.max !== undefined) {
			numSchema = numSchema.max(validation.max);
		}
		return numSchema;
	}

	if (field.type === "repeater" && schema instanceof z.ZodArray) {
		let arraySchema = schema;
		if (validation.minItems !== undefined) {
			arraySchema = arraySchema.min(validation.minItems);
		}
		if (validation.maxItems !== undefined) {
			arraySchema = arraySchema.max(validation.maxItems);
		}
		return arraySchema;
	}

	return schema;
}

const schemaCache = new Map<string, { schema: z.ZodObject<any>; version: string }>();

export function getCachedSchema(
	collection: CollectionWithFields,
	version?: string,
): z.ZodObject<any> {
	const cacheKey = collection.slug;
	const cached = schemaCache.get(cacheKey);

	if (cached && (!version || cached.version === version)) {
		return cached.schema;
	}

	const schema = generateZodSchema(collection);

	schemaCache.set(cacheKey, {
		schema,
		version: version || collection.updatedAt,
	});

	return schema;
}

export function invalidateSchemaCache(slug: string): void {
	schemaCache.delete(slug);
}

export function clearSchemaCache(): void {
	schemaCache.clear();
}

export function validateContent(
	collection: CollectionWithFields,
	data: unknown,
): { success: true; data: unknown } | { success: false; errors: z.ZodError } {
	const schema = getCachedSchema(collection);

	const result = schema.safeParse(data);

	if (result.success) {
		return { success: true, data: result.data };
	}

	return { success: false, errors: result.error };
}

export function generateTypeScript(
	collection: CollectionWithFields,
	interfaceName: string = getInterfaceName(collection),
): string {
	const lines: string[] = [];

	lines.push(`export interface ${interfaceName} {`);
	lines.push(`  id: string;`);
	lines.push(`  slug: string | null;`);
	lines.push(`  status: string;`);

	for (const field of collection.fields) {
		const tsType = fieldTypeToTypeScript(field);
		const optional = field.required ? "" : "?";
		lines.push(`  ${field.slug}${optional}: ${tsType};`);
	}

	lines.push(`  createdAt: Date;`);
	lines.push(`  updatedAt: Date;`);
	lines.push(`  publishedAt: Date | null;`);
	lines.push(`  bylines?: ContentBylineCredit[];`);
	lines.push(`  terms?: Record<string, TaxonomyTerm[]>;`);
	lines.push(`}`);

	return lines.join("\n");
}

export function generateTypesFile(collections: CollectionWithFields[]): string {
	const lines: string[] = [];

	lines.push(`// Generated by EmDash on dev server start`);
	lines.push(`// Do not edit manually`);
	lines.push(``);
	lines.push(`/// <reference types="emdash/locals" />`);
	lines.push(``);

	const needsPortableText = collections.some((c) =>
		c.fields.some((f) => f.type === "portableText"),
	);

	const imports = ["ContentBylineCredit", "TaxonomyTerm"];
	if (needsPortableText) {
		imports.push("PortableTextBlock");
	}
	lines.push(`import type { ${imports.join(", ")} } from "emdash";`);
	lines.push(``);

	const interfaceNames = uniqueInterfaceNames(collections);

	for (const collection of collections) {
		lines.push(generateTypeScript(collection, interfaceNames.get(collection.slug)));
		lines.push(``);
	}

	lines.push(`declare module "emdash" {`);
	lines.push(`  interface EmDashCollections {`);
	for (const collection of collections) {
		lines.push(`    ${collection.slug}: ${interfaceNames.get(collection.slug)};`);
	}
	lines.push(`  }`);
	lines.push(`}`);

	return lines.join("\n");
}

export async function generateSchemaHash(collections: CollectionWithFields[]): Promise<string> {
	const str = JSON.stringify(
		collections.map((c) => ({
			slug: c.slug,
			fields: c.fields.map((f) => ({
				slug: f.slug,
				type: f.type,
				required: f.required,
				validation: f.validation,
			})),
		})),
	);
	return hashString(str);
}

function fieldTypeToTypeScript(field: {
	type: Field["type"];
	validation?: Field["validation"];
}): string {
	switch (field.type) {
		case "string":
		case "text":
		case "slug":
		case "url":
		case "datetime":
			return "string";

		case "number":
		case "integer":
			return "number";

		case "boolean":
			return "boolean";

		case "select":
			const options = field.validation?.options;
			if (options && options.length > 0) {
				return options.map((o) => `"${o}"`).join(" | ");
			}
			return "string";

		case "multiSelect":
			const multiOptions = field.validation?.options;
			if (multiOptions && multiOptions.length > 0) {
				return `(${multiOptions.map((o) => `"${o}"`).join(" | ")})[]`;
			}
			return "string[]";

		case "repeater": {
			const subFields = field.validation?.subFields;
			if (!Array.isArray(subFields) || subFields.length === 0) return "unknown";

			const members = new Map<string, string>();

			for (const subField of subFields) {
				const type = fieldTypeToTypeScript({
					type: subField.type,
					validation: subField.options ? { options: subField.options } : undefined,
				});
				const name = JSON.stringify(subField.slug);
				members.set(
					subField.slug,
					subField.required ? `${name}: ${type}` : `${name}?: ${type} | null`,
				);
			}

			return `{ ${[...members.values()].join("; ")} }[]`;
		}

		case "portableText":
			return "PortableTextBlock[]";

		case "image":
			return "{ id: string; src?: string; alt?: string; width?: number; height?: number; filename?: string; mimeType?: string; blurhash?: string; dominantColor?: string; provider?: string; previewUrl?: string; meta?: Record<string, unknown> }";

		case "file":
			return "{ id: string; url?: string; src?: string; filename?: string; mimeType?: string; size?: number; provider?: string; meta?: Record<string, unknown> }";

		case "reference":
			return "string";

		case "json":
			return "unknown";

		default:
			return "unknown";
	}
}

function pascalCase(str: string): string {
	return str
		.split(PASCAL_CASE_SPLIT_PATTERN)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join("");
}

function singularize(str: string): string {
	if (str.endsWith("ies")) {
		return str.slice(0, -3) + "y";
	}
	if (
		str.endsWith("es") &&
		(str.endsWith("sses") || str.endsWith("xes") || str.endsWith("ches") || str.endsWith("shes"))
	) {
		return str.slice(0, -2);
	}
	if (str.endsWith("s") && !str.endsWith("ss")) {
		return str.slice(0, -1);
	}
	return str;
}

function getInterfaceName(collection: CollectionWithFields): string {
	return pascalCase(singularize(collection.slug));
}

export function uniqueInterfaceNames(collections: CollectionWithFields[]): Map<string, string> {
	const used = new Set<string>();
	const names = new Map<string, string>();
	for (const collection of collections) {
		const base = getInterfaceName(collection);
		let name = base;
		let suffix = 2;
		while (used.has(name)) {
			name = `${base}${suffix}`;
			suffix++;
		}
		used.add(name);
		names.set(collection.slug, name);
	}
	return names;
}
