import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import {
	API_BASE,
	apiFetch,
	parseApiResponse,
	throwResponseError,
	type FindManyResult,
} from "./client.js";

export type BylineCustomFieldValue = string | boolean | null;

export interface BylineSummary {
	id: string;
	slug: string;
	displayName: string;
	bio: string | null;
	avatarMediaId: string | null;
	websiteUrl: string | null;
	userId: string | null;
	isGuest: boolean;
	createdAt: string;
	updatedAt: string;
	locale: string;
	translationGroup: string | null;
	customFields?: Record<string, BylineCustomFieldValue>;
}

export interface BylineInput {
	slug: string;
	displayName: string;
	bio?: string | null;
	avatarMediaId?: string | null;
	websiteUrl?: string | null;
	userId?: string | null;
	isGuest?: boolean;
	locale?: string;
	translationOf?: string;
	customFields?: Record<string, unknown>;
}

export interface BylineTranslationInput {
	locale: string;
	slug?: string;
	displayName?: string;
	bio?: string | null;
	avatarMediaId?: string | null;
	websiteUrl?: string | null;
}

export interface BylineCreditInput {
	bylineId: string;
	roleLabel?: string | null;
}

export async function fetchBylines(options?: {
	search?: string;
	isGuest?: boolean;
	userId?: string;
	locale?: string;
	cursor?: string;
	limit?: number;
}): Promise<FindManyResult<BylineSummary>> {
	const params = new URLSearchParams();
	if (options?.search) params.set("search", options.search);
	if (options?.isGuest !== undefined) params.set("isGuest", String(options.isGuest));
	if (options?.userId) params.set("userId", options.userId);
	if (options?.locale) params.set("locale", options.locale);
	if (options?.cursor) params.set("cursor", options.cursor);
	if (options?.limit) params.set("limit", String(options.limit));

	const url = `${API_BASE}/admin/bylines${params.toString() ? `?${params}` : ""}`;
	const response = await apiFetch(url);
	return parseApiResponse<FindManyResult<BylineSummary>>(response, "Failed to fetch bylines");
}

export async function fetchByline(id: string): Promise<BylineSummary> {
	const response = await apiFetch(`${API_BASE}/admin/bylines/${id}`);
	return parseApiResponse<BylineSummary>(response, "Failed to fetch byline");
}

export async function createByline(input: BylineInput): Promise<BylineSummary> {
	const response = await apiFetch(`${API_BASE}/admin/bylines`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	return parseApiResponse<BylineSummary>(response, "Failed to create byline");
}

export async function updateByline(
	id: string,
	input: Partial<BylineInput>,
): Promise<BylineSummary> {
	const response = await apiFetch(`${API_BASE}/admin/bylines/${id}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	return parseApiResponse<BylineSummary>(response, "Failed to update byline");
}

export async function deleteByline(id: string): Promise<void> {
	const response = await apiFetch(`${API_BASE}/admin/bylines/${id}`, {
		method: "DELETE",
	});
	if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to delete byline`));
}

export async function fetchBylineTranslations(id: string): Promise<{ items: BylineSummary[] }> {
	const response = await apiFetch(`${API_BASE}/admin/bylines/${id}/translations`);
	return parseApiResponse<{ items: BylineSummary[] }>(
		response,
		"Failed to fetch byline translations",
	);
}

export async function createBylineTranslation(
	id: string,
	input: BylineTranslationInput,
): Promise<BylineSummary> {
	const response = await apiFetch(`${API_BASE}/admin/bylines/${id}/translations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	return parseApiResponse<BylineSummary>(response, "Failed to create byline translation");
}
