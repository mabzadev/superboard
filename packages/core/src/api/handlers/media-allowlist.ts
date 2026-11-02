import type { Kysely } from "kysely";

import type { Database } from "../../database/types.js";
import { parseAllowedMimeTypes } from "../../media/mime.js";

export const GLOBAL_UPLOAD_ALLOWLIST: readonly string[] = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
	"video/",
	"audio/",
	"application/pdf",
];

export async function resolveFieldAllowlist(
	db: Kysely<Database>,
	fieldId: string,
): Promise<string[] | null> {
	const row = await db
		.selectFrom("_emdash_fields")
		.select(["type", "validation"])
		.where("id", "=", fieldId)
		.where("type", "in", ["file", "image"])
		.executeTakeFirst();

	return row ? parseAllowedMimeTypes(row.validation) : null;
}
