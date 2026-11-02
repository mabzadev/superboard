import { sql, type Kysely } from "kysely";

import { ContentRepository } from "../../database/repositories/content.js";
import { MediaRepository } from "../../database/repositories/media.js";
import { UserRepository } from "../../database/repositories/user.js";
import type { Database } from "../../database/types.js";
import { validateIdentifier } from "../../database/validate.js";
import { getSchedulerHealth, type SchedulerHealth } from "../../scheduler-health.js";
import type { ApiResult } from "../types.js";

export interface CollectionStats {
	slug: string;
	label: string;
	total: number;
	published: number;
	draft: number;
	scheduled: number;
	overdueScheduled: number;
}

export interface RecentItem {
	id: string;
	collection: string;
	collectionLabel: string;
	title: string;
	slug: string | null;
	status: string;
	updatedAt: string;
	authorId: string | null;
}

export interface DashboardStats {
	collections: CollectionStats[];
	mediaCount: number;
	userCount: number;
	recentItems: RecentItem[];
	schedulerHealth: SchedulerHealth;
}

export async function handleDashboardStats(
	db: Kysely<Database>,
	now = new Date(),
): Promise<ApiResult<DashboardStats>> {
	try {
		const collections = await db
			.selectFrom("_emdash_collections")
			.select(["slug", "label", "title_field"])
			.where("hidden", "=", 0)
			.orderBy("slug", "asc")
			.execute();

		const contentRepo = new ContentRepository(db);
		const collectionStats: CollectionStats[] = await Promise.all(
			collections.map(async (col) => {
				const stats = await contentRepo.getStats(col.slug, now);
				return {
					slug: col.slug,
					label: col.label,
					total: stats.total,
					published: stats.published,
					draft: stats.draft,
					scheduled: stats.scheduled,
					overdueScheduled: stats.overdueScheduled,
				};
			}),
		);

		const mediaRepo = new MediaRepository(db);
		const userRepo = new UserRepository(db);
		const [mediaCount, userCount, schedulerHealth] = await Promise.all([
			mediaRepo.count(),
			userRepo.count(),
			getSchedulerHealth(db, now),
		]);

		const recentItems = await fetchRecentItems(db, collections);

		return {
			success: true,
			data: {
				collections: collectionStats,
				mediaCount,
				userCount,
				recentItems,
				schedulerHealth,
			},
		};
	} catch (error) {
		console.error("Dashboard stats error:", error);
		return {
			success: false,
			error: {
				code: "DASHBOARD_STATS_ERROR",
				message: "Failed to load dashboard statistics",
			},
		};
	}
}

interface RecentItemRow {
	id: string;
	collection: string;
	collection_label: string;
	title: string;
	slug: string | null;
	status: string;
	updated_at: string;
	author_id: string | null;
}

async function fetchRecentItems(
	db: Kysely<Database>,
	collections: Array<{ slug: string; label: string; title_field: string | null }>,
): Promise<RecentItem[]> {
	if (collections.length === 0) return [];

	const titleFields = await db
		.selectFrom("_emdash_fields as f")
		.innerJoin("_emdash_collections as c", "c.id", "f.collection_id")
		.select(["c.slug as collection_slug"])
		.where("f.slug", "=", "title")
		.execute();

	const collectionsWithTitle = new Set(titleFields.map((r) => r.collection_slug));

	const perCollection = await Promise.all(
		collections.map(async (col) => {
			validateIdentifier(col.slug);
			const table = `ec_${col.slug}`;
			const titleField = col.title_field ?? (collectionsWithTitle.has(col.slug) ? "title" : null);
			if (titleField) validateIdentifier(titleField);

			const titleExpr = titleField
				? sql`COALESCE(${sql.ref(titleField)}, slug, id)`
				: sql`COALESCE(slug, id)`;

			const result = await sql<RecentItemRow>`
				SELECT
					id,
					${sql.lit(col.slug)} AS collection,
					${sql.lit(col.label)} AS collection_label,
					${titleExpr} AS title,
					slug,
					status,
					updated_at,
					author_id
				FROM ${sql.ref(table)}
				WHERE deleted_at IS NULL
				ORDER BY updated_at DESC
				LIMIT 10
			`.execute(db);
			return result.rows;
		}),
	);

	const merged = perCollection
		.flat()
		.toSorted((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
		.slice(0, 10);

	return merged.map((row) => ({
		id: row.id,
		collection: row.collection,
		collectionLabel: row.collection_label,
		title: row.title,
		slug: row.slug,
		status: row.status,
		updatedAt: row.updated_at,
		authorId: row.author_id,
	}));
}
