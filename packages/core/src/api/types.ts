import type { ContentItem } from "../database/repositories/types.js";

export interface ListResponse<T> {
	items: T[];
	nextCursor?: string;
	total?: number;
}

export interface ContentListResponse extends ListResponse<ContentItem> {}

export interface ContentResponse {
	item: ContentItem;
	_rev?: string;
}

export interface ManifestResponse {
	version: string;
	hash: string;
	collections: Record<
		string,
		{
			label: string;
			labelSingular: string;
			supports: string[];
			routable?: boolean;
			fields: Record<string, FieldDescriptor>;
		}
	>;
	plugins: Record<
		string,
		{
			adminPages?: Array<{ path: string; component: string }>;
			widgets?: string[];
		}
	>;
}

export interface FieldDescriptor {
	kind: string;
	label?: string;
	required?: boolean;
	options?: Array<{ value: string; label: string }> | Record<string, unknown>;
}

export type ApiResult<T, E extends string = string> =
	| { success: true; data: T }
	| {
			success: false;
			error: { code: E; message: string; details?: Record<string, unknown> };
	  };

export interface ApiContext {
	userId?: string;
	userRole?: string;
}
