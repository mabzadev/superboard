export type Locale = "en" | "fr";

export interface Pagination {
	pageSize: number;
	pageNumber: number;
}

export interface Search {
	column: string;
	value: string;
}

export interface Match {
	column: string;
	value: string;
}

export interface WhereIn {
	values: number[];
}

export interface Sort {
	column: string;
	order: "ASC" | "DESC";
}
