import type { PluginDefinition, PluginContext, RouteContext, ContentHookEvent } from "emdash";
import { extractPlainText } from "emdash";

function toString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

export interface VectorizeSearchConfig {
	indexName?: string;

	model?: string;

	collections?: string[];
}

function getCloudflareEnv(request: Request): CloudflareEnv | null {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any, typescript/no-unsafe-type-assertion -- Astro locals accessed via internal symbol; no typed API available
	const locals = (request as any)[Symbol.for("astro.locals")];
	if (locals?.runtime?.env) {
		return locals.runtime.env;
	}
	return null;
}

function extractSearchableText(content: Record<string, unknown>): string {
	const parts: string[] = [];

	if (typeof content.title === "string") {
		parts.push(content.title);
	}

	for (const [key, value] of Object.entries(content)) {
		if (key === "title" || key === "id" || key === "slug") continue;

		if (typeof value === "string") {
			const text = extractPlainText(value);
			if (text) parts.push(text);
		} else if (Array.isArray(value)) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any, typescript/no-unsafe-type-assertion -- Portable Text arrays are untyped at this point; extractPlainText handles validation
			const text = extractPlainText(value as any);
			if (text) parts.push(text);
		}
	}

	return parts.join("\n");
}

export function vectorizeSearch(config: VectorizeSearchConfig = {}): PluginDefinition {
	const model = config.model ?? "@cf/bge-base-en-v1.5";
	const targetCollections = config.collections;

	let cachedEnv: CloudflareEnv | null = null;

	return {
		id: "vectorize-search",
		version: "1.0.0",
		capabilities: ["content:read"],

		hooks: {
			"content:afterSave": {
				handler: async (event: ContentHookEvent, _ctx: PluginContext): Promise<void> => {
					const { content, collection } = event;

					if (targetCollections && !targetCollections.includes(collection)) {
						return;
					}

					if (!cachedEnv) {
						console.warn(
							"[vectorize-search] Environment not available in hook. " +
								"Call the /query route first to initialize, or reindex manually.",
						);
						return;
					}

					const env = cachedEnv;
					if (!env.AI || !env.VECTORIZE) {
						console.warn(
							"[vectorize-search] AI or VECTORIZE binding not available, skipping indexing",
						);
						return;
					}

					try {
						const text = extractSearchableText(content);
						if (!text.trim()) {
							return;
						}

						const embedResult = await env.AI.run(model, {
							text: [text],
						});

						if (!embedResult?.data?.[0]) {
							console.error("[vectorize-search] Failed to generate embedding");
							return;
						}

						const contentId = toString(content.id);
						const contentSlug = toString(content.slug);
						const contentTitle = toString(content.title);

						await env.VECTORIZE.upsert([
							{
								id: contentId,
								values: embedResult.data[0],
								metadata: {
									collection,
									slug: contentSlug ?? "",
									title: contentTitle ?? "",
								},
							},
						]);

						console.log(`[vectorize-search] Indexed ${collection}/${contentId}`);
					} catch (error) {
						console.error("[vectorize-search] Error indexing content:", error);
					}
				},
			},

			"content:afterDelete": {
				handler: async (
					event: { id: string; collection: string },
					_ctx: PluginContext,
				): Promise<void> => {
					const { id, collection } = event;

					if (targetCollections && !targetCollections.includes(collection)) {
						return;
					}

					if (!cachedEnv?.VECTORIZE) {
						return;
					}

					try {
						await cachedEnv.VECTORIZE.deleteByIds([id]);
						console.log(`[vectorize-search] Removed ${collection}/${id} from index`);
					} catch (error) {
						console.error("[vectorize-search] Error removing from index:", error);
					}
				},
			},
		},

		routes: {
			query: {
				handler: async (ctx: RouteContext): Promise<unknown> => {
					const { request } = ctx;
					const input = isRecord(ctx.input) ? ctx.input : undefined;

					const env = getCloudflareEnv(request);
					if (env) {
						cachedEnv = env;
					}

					if (!env?.AI || !env?.VECTORIZE) {
						return {
							error: "Vectorize or AI binding not available",
							results: [],
						};
					}

					const query = typeof input?.q === "string" ? input.q : undefined;
					if (!query) {
						return {
							error: "Query parameter 'q' is required",
							results: [],
						};
					}

					try {
						const embedResult = await env.AI.run(model, {
							text: [query],
						});

						if (!embedResult?.data?.[0]) {
							return {
								error: "Failed to generate query embedding",
								results: [],
							};
						}

						const limit = typeof input?.limit === "number" ? input.limit : 20;
						const queryOptions: VectorizeQueryOptions = {
							topK: limit,
							returnMetadata: "all",
						};

						const collection = typeof input?.collection === "string" ? input.collection : undefined;
						if (collection) {
							queryOptions.filter = {
								collection,
							};
						}

						const results = await env.VECTORIZE.query(embedResult.data[0], queryOptions);

						return {
							results: results.matches.map((match) => ({
								id: match.id,
								score: match.score,
								collection: toString(match.metadata?.collection),
								slug: toString(match.metadata?.slug),
								title: toString(match.metadata?.title),
							})),
						};
					} catch (error) {
						console.error("[vectorize-search] Query error:", error);
						return {
							error: error instanceof Error ? error.message : "Query failed",
							results: [],
						};
					}
				},
			},

			reindex: {
				handler: async (ctx: RouteContext): Promise<unknown> => {
					const { request } = ctx;

					const env = getCloudflareEnv(request);
					if (env) {
						cachedEnv = env;
					}

					return { success: false, error: "REINDEX_NOT_SUPPORTED" };
				},
			},
		},

		admin: {
			pages: [
				{
					path: "/settings",
					label: "Vectorize Search",
					icon: "search",
				},
			],
		},
	};
}

interface CloudflareEnv {
	AI?: {
		run(model: string, input: { text: string[] }): Promise<{ data: number[][] }>;
	};
	VECTORIZE?: VectorizeIndex;
}

interface VectorizeIndex {
	upsert(
		vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>,
	): Promise<void>;
	deleteByIds(ids: string[]): Promise<void>;
	query(vector: number[], options: VectorizeQueryOptions): Promise<{ matches: VectorizeMatch[] }>;
}

interface VectorizeQueryOptions {
	topK: number;
	returnMetadata?: "all" | "indexed" | "none";
	filter?: Record<string, unknown>;
}

interface VectorizeMatch {
	id: string;
	score: number;
	metadata?: Record<string, unknown>;
}

export default vectorizeSearch;
