export type {
	SearchConfig,
	SearchTokenizer,
	SearchOptions,
	CollectionSearchOptions,
	SearchResult,
	SearchResponse,
	SuggestOptions,
	Suggestion,
	SearchStats,
} from "./types.js";
export { SEARCH_TOKENIZERS } from "./types.js";

export { FTSManager } from "./fts-manager.js";

export { search, searchWithDb, searchCollection, getSuggestions, getSearchStats } from "./query.js";

export { extractPlainText, extractSearchableFields } from "./text-extraction.js";
