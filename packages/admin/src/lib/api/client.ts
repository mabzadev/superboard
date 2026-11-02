import type { Element } from "@emdash-cms/blocks";
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export const API_BASE = "/_emdash/api";

export function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const headers = new Headers(init?.headers);
	headers.set("X-EmDash-Request", "1");
	return fetch(input, { ...init, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export class ApiResponseError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string,
		public details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "ApiResponseError";
	}
}

function formatValidationIssues(error: Record<string, unknown>): string | undefined {
	if (error.code !== "VALIDATION_ERROR") return undefined;
	if (!isRecord(error.details)) return undefined;
	const issues = error.details.issues;
	if (!Array.isArray(issues) || issues.length === 0) return undefined;

	const messages = issues
		.map((issue: unknown) => {
			if (!isRecord(issue)) return undefined;
			const { path, message } = issue;
			if (typeof message !== "string") return undefined;
			return typeof path === "string" && path.length > 0 ? `${path}: ${message}` : message;
		})
		.filter((m): m is string => m !== undefined);

	return messages.length > 0 ? messages.join("; ") : undefined;
}

export async function throwResponseError(res: Response, fallback: string): Promise<never> {
	const body: unknown = await res.json().catch(() => ({}));
	let message: string | undefined;
	let code = "UNKNOWN_ERROR";
	let details: Record<string, unknown> | undefined;
	if (isRecord(body) && isRecord(body.error)) {
		const { error } = body;
		message = formatValidationIssues(error);
		if (!message && typeof error.message === "string") message = error.message;
		if (typeof error.code === "string") code = error.code;
		if (isRecord(error.details)) details = error.details;
	}
	throw new ApiResponseError(
		res.status,
		code,
		message || `${fallback}: ${code !== "UNKNOWN_ERROR" ? code : res.statusText || res.status}`,
		details,
	);
}

export interface FindManyResult<T> {
	items: T[];
	nextCursor?: string;
	total?: number;
}

export interface AdminManifest {
	version: string;
	astroVersion?: string;
	hash: string;
	collections: Record<
		string,
		{
			label: string;
			labelSingular: string;
			supports: string[];
			hasSeo: boolean;
			urlPattern?: string;
			routable?: boolean;
			titleField?: string;
			dateField?: string;
			hidden?: boolean;
			listColumns?: string[];
			fields: Record<
				string,
				{
					id?: string;
					kind: string;
					label?: string;
					required?: boolean;
					readOnly?: boolean;
					widget?: string;
					options?: Array<{ value: string; label: string }> | Record<string, unknown>;
					validation?: Record<string, unknown>;
				}
			>;
		}
	>;
	plugins: Record<
		string,
		{
			name?: string;
			version?: string;
			package?: string;
			enabled?: boolean;
			adminMode?: "react" | "blocks" | "none";
			adminPages?: Array<{
				path: string;
				label?: string;
				icon?: string;
			}>;
			dashboardWidgets?: Array<{
				id: string;
				title?: string;
				size?: "full" | "half" | "third";
			}>;
			fieldWidgets?: Array<{
				name: string;
				label: string;
				fieldTypes: string[];
				elements?: import("@emdash-cms/blocks").Element[];
			}>;
			portableTextBlocks?: Array<{
				type: string;
				label: string;
				icon?: string;
				description?: string;
				placeholder?: string;
				fields?: Element[];
				category?: string;
			}>;
		}
	>;
	authMode: string;
	signupEnabled?: boolean;
	i18n?: {
		defaultLocale: string;
		locales: string[];
	};
	contentLocale?: {
		defaultLocale: string;
		implicit: boolean;
	};
	taxonomies: Array<{
		id?: string;
		name: string;
		label: string;
		labelSingular?: string;
		hierarchical: boolean;
		collections: string[];
		locale?: string;
		translationGroup?: string | null;
	}>;
	marketplace?: string;
	registry?: {
		aggregatorUrl: string;
		acceptLabelers?: string;
		policy?: {
			minimumReleaseAgeSeconds?: number;
			minimumReleaseAgeExclude?: string[];
		};
	};
	admin?: {
		logo?: string;
		siteName?: string;
		favicon?: string;
	};
}

export async function parseApiResponse<T>(
	response: Response,
	fallbackMessage = i18n._(msg`Request failed`),
): Promise<T> {
	if (!response.ok) await throwResponseError(response, fallbackMessage);
	const body: { data: T } = await response.json();
	return body.data;
}

export async function fetchManifest(): Promise<AdminManifest> {
	const response = await apiFetch(`${API_BASE}/manifest`);
	return parseApiResponse<AdminManifest>(response, i18n._(msg`Failed to fetch manifest`));
}

export async function fetchAuthMode(): Promise<{
	authMode: string;
	signupEnabled?: boolean;
	providers?: Array<{ id: string; label: string }>;
}> {
	const response = await apiFetch(`${API_BASE}/auth/mode`);
	return parseApiResponse<{
		authMode: string;
		signupEnabled?: boolean;
		providers?: Array<{ id: string; label: string }>;
	}>(response, i18n._(msg`Failed to fetch auth mode`));
}
