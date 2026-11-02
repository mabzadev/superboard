export type ContentFieldFilterScalar = string | number | boolean | null;

export interface ContentFieldRangeFilter {
	gt?: string | number;
	gte?: string | number;
	lt?: string | number;
	lte?: string | number;
}

export interface ContentFieldInFilter {
	in: Array<string | number | boolean>;
}

export type ContentFieldFilterValue =
	| ContentFieldFilterScalar
	| ContentFieldRangeFilter
	| ContentFieldInFilter;

export type ContentFieldFilters = Record<string, ContentFieldFilterValue>;
