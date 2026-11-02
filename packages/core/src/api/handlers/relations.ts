import type { Kysely } from "kysely";

import { ContentRepository } from "../../database/repositories/content.js";
import {
	RelationRepository,
	type ContentReference,
	type CreateRelationInput,
	type Relation,
} from "../../database/repositories/relation.js";
import { InvalidCursorError } from "../../database/repositories/types.js";
import type { ContentItem } from "../../database/repositories/types.js";
import type { Database } from "../../database/types.js";
import { resolveConfiguredLocale } from "../../i18n/config.js";
import { SchemaRegistry } from "../../schema/registry.js";
import type { ApiResult } from "../types.js";

function referencesGetError(error: unknown): ApiResult<never> {
	if (error instanceof InvalidCursorError) {
		return { success: false, error: { code: "INVALID_CURSOR", message: error.message } };
	}
	return {
		success: false,
		error: { code: "REFERENCES_GET_ERROR", message: "Failed to get references" },
	};
}

function isUniqueViolation(error: unknown): boolean {
	const message = error instanceof Error ? error.message.toLowerCase() : "";
	return message.includes("unique constraint failed") || message.includes("duplicate key");
}

export async function handleRelationCreate(
	db: Kysely<Database>,
	input: CreateRelationInput,
): Promise<ApiResult<{ relation: Relation }>> {
	try {
		const repo = new RelationRepository(db);

		if (!input.translationOf) {
			if (!input.parentCollection || !input.childCollection) {
				return {
					success: false,
					error: {
						code: "VALIDATION_ERROR",
						message:
							"parentCollection and childCollection are required unless translationOf is set",
					},
				};
			}
			const registry = new SchemaRegistry(db);
			for (const collection of [input.parentCollection, input.childCollection]) {
				if (!(await registry.getCollection(collection))) {
					return {
						success: false,
						error: {
							code: "COLLECTION_NOT_FOUND",
							message: `Collection '${collection}' not found`,
						},
					};
				}
			}
		}

		const relation = await repo.create({
			...input,
			locale: input.locale ? resolveConfiguredLocale(input.locale) : undefined,
		});
		return { success: true, data: { relation } };
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes("Source relation for translation not found")
		) {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: "Source relation for translation not found" },
			};
		}
		if (isUniqueViolation(error)) {
			return {
				success: false,
				error: {
					code: "CONFLICT",
					message: "A relation with this name or locale already exists",
				},
			};
		}
		return {
			success: false,
			error: { code: "RELATION_CREATE_ERROR", message: "Failed to create relation" },
		};
	}
}

export async function handleRelationGet(
	db: Kysely<Database>,
	id: string,
): Promise<ApiResult<{ relation: Relation }>> {
	try {
		const repo = new RelationRepository(db);
		const relation = await repo.findById(id);
		if (!relation) {
			return { success: false, error: { code: "NOT_FOUND", message: "Relation not found" } };
		}
		return { success: true, data: { relation } };
	} catch {
		return {
			success: false,
			error: { code: "RELATION_GET_ERROR", message: "Failed to get relation" },
		};
	}
}

export async function handleRelationList(
	db: Kysely<Database>,
	opts: { locale?: string },
): Promise<ApiResult<{ relations: Relation[] }>> {
	try {
		const repo = new RelationRepository(db);
		const locale = opts.locale ? resolveConfiguredLocale(opts.locale) : undefined;
		const relations = await repo.list(locale);
		return { success: true, data: { relations } };
	} catch {
		return {
			success: false,
			error: { code: "RELATION_LIST_ERROR", message: "Failed to list relations" },
		};
	}
}

export async function handleRelationUpdate(
	db: Kysely<Database>,
	id: string,
	input: { parentLabel?: string; childLabel?: string },
): Promise<ApiResult<{ relation: Relation }>> {
	try {
		const repo = new RelationRepository(db);
		const relation = await repo.update(id, input);
		if (!relation) {
			return { success: false, error: { code: "NOT_FOUND", message: "Relation not found" } };
		}
		return { success: true, data: { relation } };
	} catch {
		return {
			success: false,
			error: { code: "RELATION_UPDATE_ERROR", message: "Failed to update relation" },
		};
	}
}

export async function handleRelationDelete(
	db: Kysely<Database>,
	id: string,
): Promise<ApiResult<{ deleted: true }>> {
	try {
		const repo = new RelationRepository(db);
		const deleted = await repo.delete(id);
		if (!deleted) {
			return { success: false, error: { code: "NOT_FOUND", message: "Relation not found" } };
		}
		return { success: true, data: { deleted: true } };
	} catch {
		return {
			success: false,
			error: { code: "RELATION_DELETE_ERROR", message: "Failed to delete relation" },
		};
	}
}

export async function handleRelationTranslations(
	db: Kysely<Database>,
	id: string,
): Promise<
	ApiResult<{
		translationGroup: string;
		translations: {
			id: string;
			name: string;
			locale: string;
			parentLabel: string;
			childLabel: string;
		}[];
	}>
> {
	try {
		const repo = new RelationRepository(db);
		const relation = await repo.findById(id);
		if (!relation) {
			return { success: false, error: { code: "NOT_FOUND", message: "Relation not found" } };
		}
		const siblings = await repo.findTranslations(relation.translationGroup);
		return {
			success: true,
			data: {
				translationGroup: relation.translationGroup,
				translations: siblings.map((r) => ({
					id: r.id,
					name: r.name,
					locale: r.locale,
					parentLabel: r.parentLabel,
					childLabel: r.childLabel,
				})),
			},
		};
	} catch {
		return {
			success: false,
			error: { code: "RELATION_TRANSLATIONS_ERROR", message: "Failed to get translations" },
		};
	}
}

export type EntryRef = {
	id: string;
	slug: string | null;
	collection: string;
	locale: string | null;
	sortOrder?: number;
};

async function resolveRelation(
	repo: RelationRepository,
	idOrGroup: string,
): Promise<Relation | null> {
	const byId = await repo.findById(idOrGroup);
	if (byId) return byId;
	const group = await repo.findTranslations(idOrGroup);
	return group[0] ?? null;
}

function pickVariant(items: ContentItem[], locale: string | null): ContentItem | undefined {
	return items.find((i) => i.locale === locale) ?? items[0];
}

async function resolveEntries(
	content: ContentRepository,
	collection: string,
	edges: ContentReference[],
	pick: (e: ContentReference) => string,
	locale: string | null,
	includeDrafts: boolean,
): Promise<EntryRef[]> {
	const groups = edges.map(pick);
	const all = await content.findTranslationsForGroups(collection, groups, {
		publishedOnly: !includeDrafts,
	});

	const variantsByGroup = new Map<string, ContentItem[]>();
	for (const item of all) {
		if (item.translationGroup == null) continue;
		const list = variantsByGroup.get(item.translationGroup);
		if (list) list.push(item);
		else variantsByGroup.set(item.translationGroup, [item]);
	}

	const refs: EntryRef[] = [];
	for (const edge of edges) {
		const variants = variantsByGroup.get(pick(edge));
		if (!variants) continue;
		const entry = pickVariant(variants, locale);
		if (!entry) continue;
		refs.push({
			id: entry.id,
			slug: entry.slug,
			collection,
			locale: entry.locale,
			sortOrder: edge.sortOrder,
		});
	}
	return refs;
}

export type PageOptions = { limit?: number; cursor?: string };

export async function handleReferenceChildrenGet(
	db: Kysely<Database>,
	collection: string,
	entryId: string,
	relation: string,
	page: PageOptions = {},
	includeDrafts = false,
): Promise<ApiResult<{ children: EntryRef[]; nextCursor?: string }>> {
	try {
		const repo = new RelationRepository(db);
		const content = new ContentRepository(db);

		const rel = await resolveRelation(repo, relation);
		if (!rel)
			return { success: false, error: { code: "NOT_FOUND", message: "Relation not found" } };
		if (collection !== rel.parentCollection) {
			return {
				success: false,
				error: {
					code: "VALIDATION_ERROR",
					message: "Entry is not the parent side of this relation",
				},
			};
		}

		const entry = await content.findByIdOrSlug(collection, entryId);
		if (!entry?.translationGroup || (!includeDrafts && entry.status !== "published")) {
			return { success: false, error: { code: "NOT_FOUND", message: "Content entry not found" } };
		}

		const edges = await repo.getChildrenPage(rel.translationGroup, entry.translationGroup, page);
		const children = await resolveEntries(
			content,
			rel.childCollection,
			edges.items,
			(e) => e.childGroup,
			entry.locale,
			includeDrafts,
		);
		return { success: true, data: { children, nextCursor: edges.nextCursor } };
	} catch (error) {
		return referencesGetError(error);
	}
}

export async function handleReferenceChildrenSet(
	db: Kysely<Database>,
	collection: string,
	entryId: string,
	relation: string,
	childIds: string[],
): Promise<ApiResult<{ children: EntryRef[]; nextCursor?: string }>> {
	try {
		const repo = new RelationRepository(db);
		const content = new ContentRepository(db);

		const rel = await resolveRelation(repo, relation);
		if (!rel)
			return { success: false, error: { code: "NOT_FOUND", message: "Relation not found" } };
		if (collection !== rel.parentCollection) {
			return {
				success: false,
				error: {
					code: "VALIDATION_ERROR",
					message: "Entry is not the parent side of this relation",
				},
			};
		}

		const entry = await content.findByIdOrSlug(collection, entryId);
		if (!entry?.translationGroup) {
			return { success: false, error: { code: "NOT_FOUND", message: "Content entry not found" } };
		}

		const resolvedChildren = await content.findManyByIdOrSlug(rel.childCollection, childIds);
		const childGroups: string[] = [];
		for (const childId of childIds) {
			const child = resolvedChildren.get(childId);
			if (!child?.translationGroup) {
				return {
					success: false,
					error: {
						code: "NOT_FOUND",
						message: `Child entry '${childId}' not found in ${rel.childCollection}`,
					},
				};
			}
			childGroups.push(child.translationGroup);
		}

		await repo.setChildren(rel.translationGroup, entry.translationGroup, childGroups);

		const edges = await repo.getChildrenPage(rel.translationGroup, entry.translationGroup);
		const children = await resolveEntries(
			content,
			rel.childCollection,
			edges.items,
			(e) => e.childGroup,
			entry.locale,
			true,
		);
		return { success: true, data: { children, nextCursor: edges.nextCursor } };
	} catch {
		return {
			success: false,
			error: { code: "REFERENCES_SET_ERROR", message: "Failed to set references" },
		};
	}
}

export async function handleReferenceParentsGet(
	db: Kysely<Database>,
	collection: string,
	entryId: string,
	relation: string,
	page: PageOptions = {},
	includeDrafts = false,
): Promise<ApiResult<{ parents: EntryRef[]; nextCursor?: string }>> {
	try {
		const repo = new RelationRepository(db);
		const content = new ContentRepository(db);

		const rel = await resolveRelation(repo, relation);
		if (!rel)
			return { success: false, error: { code: "NOT_FOUND", message: "Relation not found" } };
		if (collection !== rel.childCollection) {
			return {
				success: false,
				error: {
					code: "VALIDATION_ERROR",
					message: "Entry is not the child side of this relation",
				},
			};
		}

		const entry = await content.findByIdOrSlug(collection, entryId);
		if (!entry?.translationGroup || (!includeDrafts && entry.status !== "published")) {
			return { success: false, error: { code: "NOT_FOUND", message: "Content entry not found" } };
		}

		const edges = await repo.getParentsPage(rel.translationGroup, entry.translationGroup, page);
		const parents = await resolveEntries(
			content,
			rel.parentCollection,
			edges.items,
			(e) => e.parentGroup,
			entry.locale,
			includeDrafts,
		);
		return { success: true, data: { parents, nextCursor: edges.nextCursor } };
	} catch (error) {
		return referencesGetError(error);
	}
}
