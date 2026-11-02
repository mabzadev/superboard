import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { API_BASE, apiFetch, parseApiResponse, throwResponseError } from "./client.js";

export type BylineFieldType = "string" | "text" | "url" | "boolean" | "select";

export interface BylineFieldValidation {
	options?: string[];
}

export interface BylineFieldDefinition {
	id: string;
	slug: string;
	label: string;
	type: BylineFieldType;
	required: boolean;
	translatable: boolean;
	validation: BylineFieldValidation | null;
	sortOrder: number;
	createdAt: string;
	updatedAt: string;
}

export interface BylineFieldUsage {
	translatableValueCount: number;
	groupValueCount: number;
	totalAffectedRows: number;
}

export interface CreateBylineFieldInput {
	slug: string;
	label: string;
	type: BylineFieldType;
	required?: boolean;
	translatable?: boolean;
	validation?: BylineFieldValidation | null;
	sortOrder?: number;
}

export interface UpdateBylineFieldInput {
	label?: string;
	required?: boolean;
	translatable?: boolean;
	validation?: BylineFieldValidation | null;
	sortOrder?: number;
}

const BASE = `${API_BASE}/admin/byline-fields`;

export async function listBylineFields(): Promise<{ items: BylineFieldDefinition[] }> {
	const response = await apiFetch(BASE);
	return parseApiResponse<{ items: BylineFieldDefinition[] }>(
		response,
		i18n._(msg`Failed to list byline fields`),
	);
}

export async function getBylineFieldUsage(slug: string): Promise<BylineFieldUsage> {
	const response = await apiFetch(`${BASE}/${encodeURIComponent(slug)}/usage`);
	return parseApiResponse<BylineFieldUsage>(
		response,
		i18n._(msg`Failed to read byline field usage`),
	);
}

export async function createBylineField(
	input: CreateBylineFieldInput,
): Promise<BylineFieldDefinition> {
	const response = await apiFetch(BASE, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	return parseApiResponse<BylineFieldDefinition>(
		response,
		i18n._(msg`Failed to create byline field`),
	);
}

export async function updateBylineField(
	slug: string,
	input: UpdateBylineFieldInput,
): Promise<BylineFieldDefinition> {
	const response = await apiFetch(`${BASE}/${encodeURIComponent(slug)}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	return parseApiResponse<BylineFieldDefinition>(
		response,
		i18n._(msg`Failed to update byline field`),
	);
}

export async function deleteBylineField(slug: string): Promise<void> {
	const response = await apiFetch(`${BASE}/${encodeURIComponent(slug)}`, {
		method: "DELETE",
	});
	if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to delete byline field`));
}

export async function reorderBylineFields(
	slugs: string[],
): Promise<{ items: BylineFieldDefinition[] }> {
	const response = await apiFetch(`${BASE}/reorder`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ slugs }),
	});
	return parseApiResponse<{ items: BylineFieldDefinition[] }>(
		response,
		i18n._(msg`Failed to reorder byline fields`),
	);
}
