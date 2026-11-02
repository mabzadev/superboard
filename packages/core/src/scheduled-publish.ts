import type { Kysely } from "kysely";

import { handleContentPublish } from "./api/handlers/content.js";
import { ContentRepository } from "./database/repositories/content.js";
import type { Database } from "./database/types.js";
import { SchemaRegistry } from "./schema/registry.js";

export interface PublishedRef {
	collection: string;
	id: string;
}

export const SCHEDULED_PUBLISH_BATCH_LIMIT = 100;

export type ScheduledPublishFn = (
	collection: string,
	id: string,
	options: {
		publishedAt?: string;
		requireScheduledDue?: boolean;
		expectedScheduledAt?: string;
	},
) => Promise<{ success: boolean; error?: { code?: string } }>;

export interface PublishDueContentOptions {
	publish?: ScheduledPublishFn;
	onPublished?: (refs: PublishedRef[]) => Promise<void>;
	limit?: number;
}

export async function publishDueContent(
	db: Kysely<Database>,
	options: PublishDueContentOptions = {},
): Promise<PublishedRef[]> {
	const { publish, onPublished, limit = SCHEDULED_PUBLISH_BATCH_LIMIT } = options;
	const published: PublishedRef[] = [];

	let collections;
	try {
		collections = await new SchemaRegistry(db).listCollections();
	} catch (error) {
		console.error("[scheduled-publish] Failed to list collections:", error);
		return published;
	}

	const repo = new ContentRepository(db);
	const doPublish: ScheduledPublishFn =
		publish ?? ((collection, id, opts) => handleContentPublish(db, collection, id, opts));
	const batchLimit = limit > 0 ? limit : undefined;

	for (const collection of collections) {
		try {
			const due = await repo.findReadyToPublish(collection.slug, batchLimit);
			const batch: PublishedRef[] = [];
			for (const item of due) {
				const publishedAt = item.publishedAt == null ? (item.scheduledAt ?? undefined) : undefined;
				const result = await doPublish(collection.slug, item.id, {
					publishedAt,
					requireScheduledDue: true,
					expectedScheduledAt: item.scheduledAt ?? undefined,
				});
				if (result.success) {
					batch.push({ collection: collection.slug, id: item.id });
				} else if (result.error?.code !== "NOT_DUE") {
					console.error(
						`[scheduled-publish] Failed to publish ${collection.slug}/${item.id}:`,
						result.error,
					);
				}
			}

			if (batch.length > 0) {
				published.push(...batch);
				if (onPublished) {
					try {
						await onPublished(batch);
					} catch (error) {
						console.error(
							`[scheduled-publish] onPublished failed after "${collection.slug}" batch:`,
							error,
						);
					}
				}
			}
		} catch (error) {
			console.error(`[scheduled-publish] Sweep failed for "${collection.slug}":`, error);
		}
	}

	return published;
}
