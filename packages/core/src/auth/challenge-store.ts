import type { ChallengeStore, ChallengeData } from "@emdash-cms/auth/passkey";
import type { Kysely } from "kysely";

import type { Database } from "../database/types.js";

export function createChallengeStore(db: Kysely<Database>): ChallengeStore {
	return {
		async set(challenge: string, data: ChallengeData): Promise<void> {
			const expiresAt = new Date(data.expiresAt).toISOString();

			await db
				.insertInto("auth_challenges")
				.values({
					challenge,
					type: data.type,
					user_id: data.userId ?? null,
					data: null,
					expires_at: expiresAt,
				})
				.onConflict((oc) =>
					oc.column("challenge").doUpdateSet({
						type: data.type,
						user_id: data.userId ?? null,
						expires_at: expiresAt,
					}),
				)
				.execute();
		},

		async get(challenge: string): Promise<ChallengeData | null> {
			const row = await db
				.selectFrom("auth_challenges")
				.selectAll()
				.where("challenge", "=", challenge)
				.executeTakeFirst();

			if (!row) return null;

			const expiresAt = new Date(row.expires_at).getTime();

			if (expiresAt < Date.now()) {
				await this.delete(challenge);
				return null;
			}

			return {
				type: row.type === "registration" ? "registration" : "authentication",
				userId: row.user_id ?? undefined,
				expiresAt,
			};
		},

		async delete(challenge: string): Promise<void> {
			await db.deleteFrom("auth_challenges").where("challenge", "=", challenge).execute();
		},
	};
}

export async function cleanupExpiredChallenges(db: Kysely<Database>): Promise<number> {
	const now = new Date().toISOString();

	const result = await db
		.deleteFrom("auth_challenges")
		.where("expires_at", "<", now)
		.executeTakeFirst();

	return Number(result.numDeletedRows ?? 0);
}
