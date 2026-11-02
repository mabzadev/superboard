export const SEARCH_TOKENIZERS = ["porter unicode61", "unicode61", "trigram"] as const;

export type SearchTokenizer = (typeof SEARCH_TOKENIZERS)[number];

export interface SearchConfig {
	enabled: boolean;
	weights?: Record<string, number>;
	titleField?: string;
	tokenize?: SearchTokenizer;
}

export interface SearchOptions {
	collections?: string[];
	status?: string;
	locale?: string;
	limit?: number;
	cursor?: string;
}

export interface CollectionSearchOptions {
	status?: string;
	locale?: string;
	limit?: number;
	cursor?: string;
}

export interface SearchResult {
	collection: string;
	id: string;
	slug: string | null;
	locale: string;
	title?: string;
	snippet?: string;
	score: number;
}

export interface SearchResponse {
	items: SearchResult[];
	nextCursor?: string;
}

export interface SuggestOptions {
	collections?: string[];
	locale?: string;
	limit?: number;
}

export interface Suggestion {
	collection: string;
	id: string;
	slug?: string | null;
	title: string;
}

export interface SearchStats {
	collections: Record<
		string,
		{
			indexed: number;
			lastRebuilt?: string;
		}
	>;
}
