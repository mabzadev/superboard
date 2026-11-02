import type { Kysely } from "kysely";

import type { Database } from "../../database/types.js";
import {
	BylineSchemaError,
	BylineSchemaRegistry,
	mapBylineSchemaError,
} from "../../schema/byline-registry.js";
import type {
	BylineFieldDefinition,
	CreateBylineFieldInput,
	UpdateBylineFieldInput,
} from "../../schema/types.js";
import type { ApiResult } from "../types.js";

function bylineSchemaErrorResult<T>(error: BylineSchemaError): ApiResult<T> {
	const mapped = mapBylineSchemaError(error);
	return {
		success: false,
		error: { code: mapped.code, message: mapped.message, details: mapped.details },
	};
}

function internalErrorResult<T>(
	error: unknown,
	code: string,
	fallbackMessage: string,
): ApiResult<T> {
	console.error(`[${code}]`, error);
	return {
		success: false,
		error: { code, message: fallbackMessage },
	};
}

export async function handleBylineFieldList(
	db: Kysely<Database>,
): Promise<ApiResult<{ items: BylineFieldDefinition[] }>> {
	try {
		const items = await new BylineSchemaRegistry(db).listFields();
		return { success: true, data: { items } };
	} catch (error) {
		return internalErrorResult(error, "SCHEMA_FIELD_LIST_ERROR", "Failed to list byline fields");
	}
}

export async function handleBylineFieldCreate(
	db: Kysely<Database>,
	input: CreateBylineFieldInput,
): Promise<ApiResult<BylineFieldDefinition>> {
	try {
		const field = await new BylineSchemaRegistry(db).createField(input);
		return { success: true, data: field };
	} catch (error) {
		if (error instanceof BylineSchemaError) {
			return bylineSchemaErrorResult(error);
		}
		return internalErrorResult(error, "SCHEMA_FIELD_CREATE_ERROR", "Failed to create byline field");
	}
}

export async function handleBylineFieldGet(
	db: Kysely<Database>,
	slug: string,
): Promise<ApiResult<BylineFieldDefinition>> {
	try {
		const field = await new BylineSchemaRegistry(db).getField(slug);
		if (!field) {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: "Byline field not found" },
			};
		}
		return { success: true, data: field };
	} catch (error) {
		return internalErrorResult(error, "SCHEMA_FIELD_GET_ERROR", "Failed to get byline field");
	}
}

export async function handleBylineFieldUpdate(
	db: Kysely<Database>,
	slug: string,
	input: UpdateBylineFieldInput,
): Promise<ApiResult<BylineFieldDefinition>> {
	try {
		const field = await new BylineSchemaRegistry(db).updateField(slug, input);
		return { success: true, data: field };
	} catch (error) {
		if (error instanceof BylineSchemaError) {
			return bylineSchemaErrorResult(error);
		}
		return internalErrorResult(error, "SCHEMA_FIELD_UPDATE_ERROR", "Failed to update byline field");
	}
}

export async function handleBylineFieldDelete(
	db: Kysely<Database>,
	slug: string,
): Promise<ApiResult<{ deleted: true }>> {
	try {
		await new BylineSchemaRegistry(db).deleteField(slug);
		return { success: true, data: { deleted: true } };
	} catch (error) {
		if (error instanceof BylineSchemaError) {
			return bylineSchemaErrorResult(error);
		}
		return internalErrorResult(error, "SCHEMA_FIELD_DELETE_ERROR", "Failed to delete byline field");
	}
}

export async function handleBylineFieldUsage(
	db: Kysely<Database>,
	slug: string,
): Promise<
	ApiResult<{
		translatableValueCount: number;
		groupValueCount: number;
		totalAffectedRows: number;
	}>
> {
	try {
		const usage = await new BylineSchemaRegistry(db).getFieldUsage(slug);
		return { success: true, data: usage };
	} catch (error) {
		if (error instanceof BylineSchemaError) {
			return bylineSchemaErrorResult(error);
		}
		return internalErrorResult(
			error,
			"SCHEMA_FIELD_GET_ERROR",
			"Failed to read byline field usage",
		);
	}
}

export async function handleBylineFieldReorder(
	db: Kysely<Database>,
	slugs: string[],
): Promise<ApiResult<{ items: BylineFieldDefinition[] }>> {
	try {
		const registry = new BylineSchemaRegistry(db);
		await registry.reorderFields(slugs);
		const items = await registry.listFields();
		return { success: true, data: { items } };
	} catch (error) {
		if (error instanceof BylineSchemaError) {
			return bylineSchemaErrorResult(error);
		}
		return internalErrorResult(
			error,
			"SCHEMA_FIELD_REORDER_ERROR",
			"Failed to reorder byline fields",
		);
	}
}
