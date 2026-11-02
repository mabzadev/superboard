import type { ContentFieldFilters } from "../../content-list-query.js";
import type { CustomFieldValue } from "../../schema/types.js";
import { encodeBase64, decodeBase64 } from "../../utils/base64.js";

const MAX_CURSOR_LENGTH = 4096;

export interface CreateContentInput {
	id?: string;
	type: string;
	slug?: string | null;
	data: Record<string, unknown>;
	status?: string;
	authorId?: string;
	primaryBylineId?: string | null;
	locale?: string;
	translationOf?: string;
	publishedAt?: string | null;
	createdAt?: string | null;
}

export interface UpdateContentInput {
	data?: Record<string, unknown>;
	status?: string;
	slug?: string | null;
	publishedAt?: string | null;
	scheduledAt?: string | null;
	authorId?: string | null;
	primaryBylineId?: string | null;
}

export interface ContentSeo {
	title: string | null;
	description: string | null;
	image: string | null;
	canonical: string | null;
	noIndex: boolean;
}

export interface ContentSeoInput {
	title?: string | null;
	description?: string | null;
	image?: string | null;
	canonical?: string | null;
	noIndex?: boolean;
}

export interface BylineSummary {
	id: string;
	slug: string;
	displayName: string;
	bio: string | null;
	avatarMediaId: string | null;
	avatarStorageKey?: string | null;
	avatarAlt?: string | null;
	avatarBlurhash?: string | null;
	avatarDominantColor?: string | null;
	websiteUrl: string | null;
	userId: string | null;
	isGuest: boolean;
	createdAt: string;
	updatedAt: string;
	locale: string;
	translationGroup: string | null;
	customFields?: Record<string, CustomFieldValue>;
}

export interface ContentBylineCredit {
	byline: BylineSummary;
	sortOrder: number;
	roleLabel: string | null;
	source?: "explicit" | "inferred";
}

export type ContentDateField = "createdAt" | "updatedAt" | "publishedAt";

export interface ContentDateFilter {
	field: ContentDateField;
	from?: string;
	to?: string;
}

export interface ContentBylineFilter {
	mode: "any" | "none";
	bylineIds?: string[];
	includeInferred?: boolean;
	locale?: string;
}

export interface FindManyOptions {
	where?: {
		status?: string;
		authorId?: string;
		locale?: string;
		q?: string;
		searchColumns?: string[];
		useFts?: boolean;
		dateFilter?: ContentDateFilter;
		bylineFilter?: ContentBylineFilter;
		fieldFilters?: ContentFieldFilters;
	};
	orderBy?: {
		field: string;
		direction: "asc" | "desc";
	};
	sortableExtras?: string[];
	limit?: number;
	cursor?: string;
}

export interface FindManyResult<T> {
	items: T[];
	nextCursor?: string;
	total?: number;
}

export function encodeCursor(orderValue: string, id: string): string {
	return encodeBase64(JSON.stringify({ orderValue, id }));
}

export class InvalidCursorError extends Error {
	constructor(cursor: string) {
		const display = cursor.length > 50 ? `${cursor.slice(0, 47)}...` : cursor;
		super(`Invalid pagination cursor: ${display}`);
		this.name = "InvalidCursorError";
	}
}

export function decodeCursor(cursor: string): { orderValue: string; id: string } {
	if (!cursor) throw new InvalidCursorError(cursor);
	if (cursor.length > MAX_CURSOR_LENGTH) throw new InvalidCursorError(cursor);
	let parsed: unknown;
	try {
		parsed = JSON.parse(decodeBase64(cursor));
	} catch {
		throw new InvalidCursorError(cursor);
	}
	if (parsed === null || typeof parsed !== "object") {
		throw new InvalidCursorError(cursor);
	}
	const candidate = parsed as { orderValue?: unknown; id?: unknown };
	if (typeof candidate.orderValue !== "string" || typeof candidate.id !== "string") {
		throw new InvalidCursorError(cursor);
	}
	return { orderValue: candidate.orderValue, id: candidate.id };
}

export interface ContentItem {
	id: string;
	type: string;
	slug: string | null;
	status: string;
	data: Record<string, unknown>;
	authorId: string | null;
	primaryBylineId: string | null;
	byline?: BylineSummary | null;
	bylines?: ContentBylineCredit[];
	createdAt: string;
	updatedAt: string;
	publishedAt: string | null;
	scheduledAt: string | null;
	liveRevisionId: string | null;
	draftRevisionId: string | null;
	version: number;
	locale: string | null;
	translationGroup: string | null;
	seo?: ContentSeo;
	liveData?: Record<string, unknown>;
}

export class EmDashValidationError extends Error {
	constructor(
		message: string,
		public details?: unknown,
	) {
		super(message);
		this.name = "EmDashValidationError";
	}
}

export class ContentCollectionNotFoundError extends Error {
	constructor(collection: string) {
		super(`Collection '${collection}' not found`);
		this.name = "ContentCollectionNotFoundError";
	}
}

export class ScheduledNotDueError extends Error {
	constructor(message = "Content is no longer scheduled to publish") {
		super(message);
		this.name = "ScheduledNotDueError";
	}
}

export class ContentMutationConflictError extends Error {
	constructor(message = "Content changed while the operation was in progress") {
		super(message);
		this.name = "ContentMutationConflictError";
	}
}
