import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type { BylineCreditInput, BylineSummary } from "./bylines.js";
import {
	API_BASE,
	apiFetch,
	parseApiResponse,
	throwResponseError,
	type FindManyResult,
} from "./client.js";

export function getDraftStatus(
	item: ContentItem,
): "unpublished" | "published" | "published_with_changes" {
	if (!item.liveRevisionId) return "unpublished";
	if (item.draftRevisionId && item.draftRevisionId !== item.liveRevisionId)
		return "published_with_changes";
	return "published";
}

export interface ContentSeo {
	title: string | null;
	description: string | null;
	image: string | null;
	canonical: string | null;
	noIndex: boolean;
}

export interface ContentItem {
	id: string;
	type: string;
	slug: string | null;
	status: string;
	locale: string;
	translationGroup: string | null;
	data: Record<string, unknown>;
	authorId: string | null;
	primaryBylineId: string | null;
	byline?: BylineSummary | null;
	bylines?: Array<{
		byline: BylineSummary;
		sortOrder: number;
		roleLabel: string | null;
		source?: "explicit" | "inferred";
	}>;
	createdAt: string;
	updatedAt: string;
	publishedAt: string | null;
	scheduledAt: string | null;
	liveRevisionId: string | null;
	draftRevisionId: string | null;
	seo?: ContentSeo;
}

export interface CreateContentInput {
	type: string;
	slug?: string | null;
	data: Record<string, unknown>;
	status?: string;
	bylines?: BylineCreditInput[];
	locale?: string;
	translationOf?: string;
}

export interface TranslationSummary {
	id: string;
	locale: string;
	slug: string | null;
	status: string;
	updatedAt: string;
}

export interface TranslationsResponse {
	translationGroup: string;
	translations: TranslationSummary[];
}

export async function fetchTranslations(
	collection: string,
	id: string,
): Promise<TranslationsResponse> {
	const response = await apiFetch(`${API_BASE}/content/${collection}/${id}/translations`);
	return parseApiResponse<TranslationsResponse>(response, "Failed to fetch translations");
}

export interface ContentSeoInput {
	title?: string | null;
	description?: string | null;
	image?: string | null;
	canonical?: string | null;
	noIndex?: boolean;
}

export interface UpdateContentInput {
	data?: Record<string, unknown>;
	slug?: string | null;
	status?: string;
	publishedAt?: string | null;
	authorId?: string | null;
	bylines?: BylineCreditInput[];
	skipRevision?: boolean;
	seo?: ContentSeoInput;
}

export interface TrashedContentItem extends ContentItem {
	deletedAt: string;
}

export interface PreviewUrlResponse {
	url: string;
	expiresAt: number;
}

export type ContentDateField = "createdAt" | "updatedAt" | "publishedAt";

export async function fetchContentList(
	collection: string,
	options?: {
		cursor?: string;
		limit?: number;
		status?: string;
		locale?: string;
		orderBy?: string;
		order?: "asc" | "desc";
		search?: string;
		authorId?: string;
		dateField?: ContentDateField;
		dateFrom?: string;
		dateTo?: string;
		bylines?: string[];
		bylinesNone?: boolean;
		includeInferredBylines?: boolean;
	},
): Promise<FindManyResult<ContentItem>> {
	const params = new URLSearchParams();
	if (options?.cursor) params.set("cursor", options.cursor);
	if (options?.limit) params.set("limit", String(options.limit));
	if (options?.status) params.set("status", options.status);
	if (options?.locale) params.set("locale", options.locale);
	if (options?.orderBy) params.set("orderBy", options.orderBy);
	if (options?.order) params.set("order", options.order);
	if (options?.search) params.set("q", options.search);
	if (options?.authorId) params.set("authorId", options.authorId);
	if (options?.dateField && (options.dateFrom || options.dateTo)) {
		params.set("dateField", options.dateField);
		if (options.dateFrom) params.set("dateFrom", options.dateFrom);
		if (options.dateTo) params.set("dateTo", options.dateTo);
	}
	if (options?.bylinesNone) {
		params.set("bylines", "none");
	} else if (options?.bylines && options.bylines.length > 0) {
		params.set("bylines", options.bylines.join(","));
	}
	if (options?.includeInferredBylines && (options.bylinesNone || options.bylines?.length)) {
		params.set("includeInferredBylines", "1");
	}

	const url = `${API_BASE}/content/${collection}${params.toString() ? `?${params}` : ""}`;
	const response = await apiFetch(url);
	return parseApiResponse<FindManyResult<ContentItem>>(response, "Failed to fetch content");
}

export interface ContentAuthor {
	id: string;
	name: string | null;
	email: string;
	avatarUrl: string | null;
}

export async function fetchContentAuthors(collection: string): Promise<ContentAuthor[]> {
	const response = await apiFetch(`${API_BASE}/content/${collection}/authors`);
	const data = await parseApiResponse<{ items: ContentAuthor[] }>(
		response,
		"Failed to fetch content authors",
	);
	return data.items;
}

export async function fetchContent(
	collection: string,
	id: string,
	options?: { locale?: string },
): Promise<ContentItem> {
	const params = new URLSearchParams();
	if (options?.locale) params.set("locale", options.locale);
	const query = params.toString() ? `?${params}` : "";
	const response = await apiFetch(`${API_BASE}/content/${collection}/${id}${query}`);
	const data = await parseApiResponse<{ item: ContentItem }>(response, "Failed to fetch content");
	return data.item;
}

export async function createContent(
	collection: string,
	input: Omit<CreateContentInput, "type">,
): Promise<ContentItem> {
	const response = await apiFetch(`${API_BASE}/content/${collection}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			data: input.data,
			slug: input.slug,
			status: input.status,
			bylines: input.bylines,
			locale: input.locale,
			translationOf: input.translationOf,
		}),
	});
	const data = await parseApiResponse<{ item: ContentItem }>(response, "Failed to create content");
	return data.item;
}

export async function updateContent(
	collection: string,
	id: string,
	input: UpdateContentInput,
	options?: { locale?: string },
): Promise<ContentItem> {
	const params = new URLSearchParams();
	if (options?.locale) params.set("locale", options.locale);
	const query = params.toString() ? `?${params}` : "";
	const response = await apiFetch(`${API_BASE}/content/${collection}/${id}${query}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	const data = await parseApiResponse<{ item: ContentItem }>(response, "Failed to update content");
	return data.item;
}

export async function deleteContent(
	collection: string,
	id: string,
	options?: { locale?: string },
): Promise<void> {
	const params = new URLSearchParams();
	if (options?.locale) params.set("locale", options.locale);
	const query = params.toString() ? `?${params}` : "";
	const response = await apiFetch(`${API_BASE}/content/${collection}/${id}${query}`, {
		method: "DELETE",
	});
	if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to delete content`));
}

export async function fetchTrashedContent(
	collection: string,
	options?: {
		cursor?: string;
		limit?: number;
	},
): Promise<FindManyResult<TrashedContentItem>> {
	const params = new URLSearchParams();
	if (options?.cursor) params.set("cursor", options.cursor);
	if (options?.limit) params.set("limit", String(options.limit));

	const url = `${API_BASE}/content/${collection}/trash${params.toString() ? `?${params}` : ""}`;
	const response = await apiFetch(url);
	return parseApiResponse<FindManyResult<TrashedContentItem>>(
		response,
		"Failed to fetch trashed content",
	);
}

export async function restoreContent(collection: string, id: string): Promise<void> {
	const response = await apiFetch(`${API_BASE}/content/${collection}/${id}/restore`, {
		method: "POST",
	});
	if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to restore content`));
}

export async function permanentDeleteContent(collection: string, id: string): Promise<void> {
	const response = await apiFetch(`${API_BASE}/content/${collection}/${id}/permanent`, {
		method: "DELETE",
	});
	if (!response.ok)
		await throwResponseError(response, i18n._(msg`Failed to permanently delete content`));
}

export async function duplicateContent(collection: string, id: string): Promise<ContentItem> {
	const response = await apiFetch(`${API_BASE}/content/${collection}/${id}/duplicate`, {
		method: "POST",
	});
	const data = await parseApiResponse<{ item: ContentItem }>(
		response,
		"Failed to duplicate content",
	);
	return data.item;
}

export async function scheduleContent(
	collection: string,
	id: string,
	scheduledAt: string,
	options?: { locale?: string },
): Promise<ContentItem> {
	const params = new URLSearchParams();
	if (options?.locale) params.set("locale", options.locale);
	const query = params.toString() ? `?${params}` : "";
	const response = await apiFetch(`${API_BASE}/content/${collection}/${id}/schedule${query}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ scheduledAt }),
	});
	const data = await parseApiResponse<{ item: ContentItem }>(
		response,
		"Failed to schedule content",
	);
	return data.item;
}

export async function unscheduleContent(
	collection: string,
	id: string,
	options?: { locale?: string },
): Promise<ContentItem> {
	const params = new URLSearchParams();
	if (options?.locale) params.set("locale", options.locale);
	const query = params.toString() ? `?${params}` : "";
	const response = await apiFetch(`${API_BASE}/content/${collection}/${id}/schedule${query}`, {
		method: "DELETE",
	});
	const data = await parseApiResponse<{ item: ContentItem }>(
		response,
		"Failed to unschedule content",
	);
	return data.item;
}

export async function getPreviewUrl(
	collection: string,
	id: string,
	options?: {
		expiresIn?: string;
		pathPattern?: string;
	},
): Promise<PreviewUrlResponse | null> {
	try {
		const response = await apiFetch(`${API_BASE}/content/${collection}/${id}/preview-url`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(options || {}),
		});

		if (response.status === 500) {
			const body: unknown = await response.json().catch(() => ({}));
			if (
				typeof body === "object" &&
				body !== null &&
				"error" in body &&
				typeof body.error === "object" &&
				body.error !== null &&
				"code" in body.error &&
				body.error.code === "NOT_CONFIGURED"
			) {
				return null;
			}
			throw new Error("Failed to get preview URL");
		}

		return parseApiResponse<PreviewUrlResponse>(response, "Failed to get preview URL");
	} catch {
		return null;
	}
}

export async function publishContent(
	collection: string,
	id: string,
	options?: { locale?: string },
): Promise<ContentItem> {
	const params = new URLSearchParams();
	if (options?.locale) params.set("locale", options.locale);
	const query = params.toString() ? `?${params}` : "";
	const response = await apiFetch(`${API_BASE}/content/${collection}/${id}/publish${query}`, {
		method: "POST",
	});
	const data = await parseApiResponse<{ item: ContentItem }>(response, "Failed to publish content");
	return data.item;
}

export async function unpublishContent(
	collection: string,
	id: string,
	options?: { locale?: string },
): Promise<ContentItem> {
	const params = new URLSearchParams();
	if (options?.locale) params.set("locale", options.locale);
	const query = params.toString() ? `?${params}` : "";
	const response = await apiFetch(`${API_BASE}/content/${collection}/${id}/unpublish${query}`, {
		method: "POST",
	});
	const data = await parseApiResponse<{ item: ContentItem }>(
		response,
		"Failed to unpublish content",
	);
	return data.item;
}

export async function discardDraft(
	collection: string,
	id: string,
	options?: { locale?: string },
): Promise<ContentItem> {
	const params = new URLSearchParams();
	if (options?.locale) params.set("locale", options.locale);
	const query = params.toString() ? `?${params}` : "";
	const response = await apiFetch(`${API_BASE}/content/${collection}/${id}/discard-draft${query}`, {
		method: "POST",
	});
	const data = await parseApiResponse<{ item: ContentItem }>(response, "Failed to discard draft");
	return data.item;
}

export async function compareRevisions(
	collection: string,
	id: string,
): Promise<{
	hasChanges: boolean;
	live: Record<string, unknown> | null;
	draft: Record<string, unknown> | null;
}> {
	const response = await apiFetch(`${API_BASE}/content/${collection}/${id}/compare`);
	return parseApiResponse<{
		hasChanges: boolean;
		live: Record<string, unknown> | null;
		draft: Record<string, unknown> | null;
	}>(response, "Failed to compare revisions");
}

export interface Revision {
	id: string;
	collection: string;
	entryId: string;
	data: Record<string, unknown>;
	authorId: string | null;
	createdAt: string;
}

export interface RevisionListResponse {
	items: Revision[];
	total: number;
}

export async function fetchRevisions(
	collection: string,
	entryId: string,
	options?: { limit?: number },
): Promise<RevisionListResponse> {
	const params = new URLSearchParams();
	if (options?.limit) params.set("limit", String(options.limit));

	const url = `${API_BASE}/content/${collection}/${entryId}/revisions${params.toString() ? `?${params}` : ""}`;
	const response = await apiFetch(url);
	return parseApiResponse<RevisionListResponse>(response, "Failed to fetch revisions");
}

export async function fetchRevision(revisionId: string): Promise<Revision> {
	const response = await apiFetch(`${API_BASE}/revisions/${revisionId}`);

	if (!response.ok) {
		if (response.status === 404) {
			throw new Error(`Revision not found: ${revisionId}`);
		}
		await throwResponseError(response, i18n._(msg`Failed to fetch revision`));
	}

	const data = await parseApiResponse<{ item: Revision }>(
		response,
		i18n._(msg`Failed to fetch revision`),
	);
	return data.item;
}

export async function restoreRevision(revisionId: string): Promise<ContentItem> {
	const response = await apiFetch(`${API_BASE}/revisions/${revisionId}/restore`, {
		method: "POST",
	});

	if (!response.ok) {
		if (response.status === 404) {
			throw new Error(`Revision not found: ${revisionId}`);
		}
		await throwResponseError(response, i18n._(msg`Failed to restore revision`));
	}

	const data = await parseApiResponse<{ item: ContentItem }>(
		response,
		i18n._(msg`Failed to restore revision`),
	);
	return data.item;
}
