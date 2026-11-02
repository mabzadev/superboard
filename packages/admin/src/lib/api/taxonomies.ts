import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { API_BASE, apiFetch, parseApiResponse, throwResponseError } from "./client.js";

export interface TaxonomyTerm {
	id: string;
	name: string;
	slug: string;
	label: string;
	parentId?: string;
	description?: string;
	children: TaxonomyTerm[];
	count?: number;
	locale: string;
	translationGroup: string | null;
}

export interface TaxonomyDef {
	id: string;
	name: string;
	label: string;
	labelSingular?: string;
	hierarchical: boolean;
	collections: string[];
	locale: string;
	translationGroup: string | null;
}

export interface TermTranslation {
	id: string;
	slug: string;
	label: string;
	locale: string;
}

export interface TermTranslationsResponse {
	translationGroup: string | null;
	translations: TermTranslation[];
}

export interface TaxonomyDefTranslation {
	id: string;
	name: string;
	label: string;
	locale: string;
}

export interface TaxonomyDefTranslationsResponse {
	translationGroup: string | null;
	translations: TaxonomyDefTranslation[];
}

export interface CreateTaxonomyInput {
	name: string;
	label: string;
	labelSingular?: string;
	hierarchical?: boolean;
	collections?: string[];
	locale?: string;
	translationOf?: string;
}

export interface CreateTermInput {
	slug?: string;
	label: string;
	parentId?: string;
	description?: string;
	locale?: string;
	translationOf?: string;
}

export interface UpdateTermInput {
	slug?: string;
	label?: string;
	parentId?: string;
	description?: string;
}

export interface LocaleOptions {
	locale?: string;
}

export function withLocale(path: string, locale?: string): string {
	return locale
		? `${path}${path.includes("?") ? "&" : "?"}locale=${encodeURIComponent(locale)}`
		: path;
}

export async function fetchTaxonomyDefs(options: LocaleOptions = {}): Promise<TaxonomyDef[]> {
	const response = await apiFetch(withLocale(`${API_BASE}/taxonomies`, options.locale));
	const data = await parseApiResponse<{ taxonomies: TaxonomyDef[] }>(
		response,
		"Failed to fetch taxonomies",
	);
	return data.taxonomies;
}

export async function fetchTaxonomyDef(
	name: string,
	options: LocaleOptions = {},
): Promise<TaxonomyDef | null> {
	const defs = await fetchTaxonomyDefs(options);
	return defs.find((t) => t.name === name) || null;
}

export async function createTaxonomy(input: CreateTaxonomyInput): Promise<TaxonomyDef> {
	const response = await apiFetch(`${API_BASE}/taxonomies`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	const data = await parseApiResponse<{ taxonomy: TaxonomyDef }>(
		response,
		"Failed to create taxonomy",
	);
	return data.taxonomy;
}

export async function fetchTerms(
	taxonomyName: string,
	options: LocaleOptions = {},
): Promise<TaxonomyTerm[]> {
	const response = await apiFetch(
		withLocale(`${API_BASE}/taxonomies/${taxonomyName}/terms`, options.locale),
	);
	const data = await parseApiResponse<{ terms: TaxonomyTerm[] }>(response, "Failed to fetch terms");
	return data.terms;
}

export async function createTerm(
	taxonomyName: string,
	input: CreateTermInput,
): Promise<TaxonomyTerm> {
	const response = await apiFetch(`${API_BASE}/taxonomies/${taxonomyName}/terms`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	const data = await parseApiResponse<{ term: TaxonomyTerm }>(response, "Failed to create term");
	return data.term;
}

export async function updateTerm(
	taxonomyName: string,
	slug: string,
	input: UpdateTermInput,
	options: LocaleOptions = {},
): Promise<TaxonomyTerm> {
	const response = await apiFetch(
		withLocale(`${API_BASE}/taxonomies/${taxonomyName}/terms/${slug}`, options.locale),
		{
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		},
	);
	const data = await parseApiResponse<{ term: TaxonomyTerm }>(response, "Failed to update term");
	return data.term;
}

export async function reorderTerms(
	taxonomyName: string,
	input: { parentId: string | null; ids: string[] },
): Promise<void> {
	const response = await apiFetch(`${API_BASE}/taxonomies/${taxonomyName}/reorder`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	await parseApiResponse<{ reordered: true }>(response, "Failed to reorder terms");
}

export async function deleteTerm(
	taxonomyName: string,
	slug: string,
	options: LocaleOptions = {},
): Promise<void> {
	const response = await apiFetch(
		withLocale(`${API_BASE}/taxonomies/${taxonomyName}/terms/${slug}`, options.locale),
		{ method: "DELETE" },
	);
	if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to delete term`));
}

export async function fetchTermTranslations(
	taxonomyName: string,
	slug: string,
	options: LocaleOptions = {},
): Promise<TermTranslationsResponse> {
	const response = await apiFetch(
		withLocale(`${API_BASE}/taxonomies/${taxonomyName}/terms/${slug}/translations`, options.locale),
	);
	return parseApiResponse<TermTranslationsResponse>(response, "Failed to fetch term translations");
}

export async function createTermTranslation(
	taxonomyName: string,
	slug: string,
	input: { locale: string; label?: string; slug?: string },
	options: LocaleOptions = {},
): Promise<TaxonomyTerm> {
	const response = await apiFetch(
		withLocale(`${API_BASE}/taxonomies/${taxonomyName}/terms/${slug}/translations`, options.locale),
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		},
	);
	const data = await parseApiResponse<{ term: TaxonomyTerm }>(
		response,
		"Failed to create term translation",
	);
	return data.term;
}
