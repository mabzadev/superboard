import type { ResolvedPlugin } from "emdash";
import { definePlugin } from "emdash";

import { DEFAULT_CATEGORIES, buildTaxonomy } from "./categories.js";
import type { Category } from "./categories.js";
import { computeDecision } from "./decision.js";
import type { AIModerationOptions } from "./descriptor.js";
import { runGuard } from "./guard.js";
import type { GuardResult } from "./guard.js";

const KV_CATEGORIES = "config:categories";
const KV_BEHAVIOR = "config:behavior";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createPlugin(options: AIModerationOptions = {}): ResolvedPlugin {
	const defaultAutoApprove = options.autoApproveClean ?? true;
	const aiBinding = options.aiBinding ?? "AI";

	async function loadCategories(kv: {
		get: <T>(key: string) => Promise<T | null>;
	}): Promise<Category[]> {
		const stored = await kv.get<Category[]>(KV_CATEGORIES);
		return stored ?? options.categories ?? DEFAULT_CATEGORIES;
	}

	async function loadBehavior(kv: {
		get: <T>(key: string) => Promise<T | null>;
	}): Promise<{ autoApproveClean: boolean }> {
		const stored = await kv.get<{ autoApproveClean: boolean }>(KV_BEHAVIOR);
		return stored ?? { autoApproveClean: defaultAutoApprove };
	}

	return definePlugin({
		id: "ai-moderation",
		version: "0.1.0",
		capabilities: [],
		allowedHosts: [],

		admin: {
			entry: "@emdash-cms/plugin-ai-moderation/admin",
			pages: [{ path: "/settings", label: "AI Moderation", icon: "shield" }],
			widgets: [{ id: "status", title: "AI Moderation", size: "third" }],
		},

		hooks: {
			"comment:beforeCreate": {
				priority: 10,
				errorPolicy: "continue",
				handler: async (event, ctx) => {
					const categories = await loadCategories(ctx.kv);

					let guard: GuardResult | undefined;
					let guardError: string | undefined;

					const taxonomy = buildTaxonomy(categories);
					if (taxonomy) {
						try {
							guard = await runGuard(event.comment.body, taxonomy, aiBinding);
						} catch (error) {
							guardError = "AI classification failed";
							ctx.log.error("AI guard failed", {
								error: error instanceof Error ? error.message : String(error),
							});
						}
					}

					event.metadata.aiGuard = guard;
					event.metadata.aiGuardError = guardError;

					return event;
				},
			},

			"comment:moderate": {
				exclusive: true,
				handler: async (event, ctx) => {
					const categories = await loadCategories(ctx.kv);
					const behavior = await loadBehavior(ctx.kv);

					const guard = event.metadata.aiGuard as GuardResult | undefined;
					const guardError = event.metadata.aiGuardError as string | undefined;

					const isAuthenticated = !!event.comment.authorUserId;

					return computeDecision(
						guard,
						guardError,
						categories,
						behavior,
						event.collectionSettings,
						event.priorApprovedCount,
						isAuthenticated,
					);
				},
			},
		},

		routes: {
			settings: {
				handler: async (ctx) => {
					const categories = await loadCategories(ctx.kv);
					const behavior = await loadBehavior(ctx.kv);

					return { categories, behavior };
				},
			},

			"settings/save": {
				handler: async (ctx) => {
					const input = isRecord(ctx.input) ? ctx.input : {};

					if (Array.isArray(input.categories)) {
						const cats = input.categories as Category[];
						const seenIds = new Set<string>();
						for (const cat of cats) {
							if (
								typeof cat.id !== "string" ||
								typeof cat.name !== "string" ||
								typeof cat.description !== "string" ||
								!cat.id ||
								!cat.name ||
								!cat.description ||
								cat.id.length > 10 ||
								cat.name.length > 100 ||
								cat.description.length > 500 ||
								!["block", "hold", "ignore"].includes(cat.action)
							) {
								return {
									success: false,
									error: `Invalid category: ${typeof cat.id === "string" ? cat.id : "missing id"}`,
								};
							}
							if (seenIds.has(cat.id)) {
								return {
									success: false,
									error: `Duplicate category ID: ${cat.id}`,
								};
							}
							seenIds.add(cat.id);
						}
						await ctx.kv.set(KV_CATEGORIES, cats);
					}

					if (isRecord(input.behavior)) {
						const behavior = {
							autoApproveClean:
								typeof input.behavior.autoApproveClean === "boolean"
									? input.behavior.autoApproveClean
									: defaultAutoApprove,
						};
						await ctx.kv.set(KV_BEHAVIOR, behavior);
					}

					return { success: true };
				},
			},

			"settings/test": {
				handler: async (ctx) => {
					const input = isRecord(ctx.input) ? ctx.input : {};
					const text = typeof input.text === "string" ? input.text : "";

					if (!text.trim()) {
						return { success: false, error: "No text provided" };
					}

					const categories = await loadCategories(ctx.kv);

					let guard: GuardResult | undefined;
					let guardError: string | undefined;
					const taxonomy = buildTaxonomy(categories);

					if (taxonomy) {
						try {
							guard = await runGuard(text, taxonomy, aiBinding);
						} catch (error) {
							guardError = error instanceof Error ? error.message : String(error);
						}
					}

					return {
						success: true,
						guard: guard ?? null,
						guardError: guardError ?? null,
						taxonomy,
					};
				},
			},

			status: {
				handler: async (ctx) => {
					const categories = await loadCategories(ctx.kv);
					const behavior = await loadBehavior(ctx.kv);

					return {
						enabled: true,
						categoryCount: categories.filter((c) => c.action !== "ignore").length,
						autoApproveClean: behavior.autoApproveClean,
					};
				},
			},
		},
	});
}

export default createPlugin;
