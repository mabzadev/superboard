export const OBSERVATION_RETENTION_MS = 14 * 86_400_000;
const PRUNE_BATCH_SIZE = 1000;
const PRUNE_MAX_BATCHES = 20;

// Incidents and their transitions are kept; only raw per-invocation observations expire.
export async function pruneObservabilityObservations(
	db: D1Database,
	now = Date.now(),
): Promise<number> {
	const cutoff = new Date(now - OBSERVATION_RETENTION_MS).toISOString();
	const expired =
		"SELECT instance_id, observation_id FROM observability_observations WHERE observed_at < ? ORDER BY observed_at, instance_id, observation_id LIMIT ?";
	let deleted = 0;
	for (let round = 0; round < PRUNE_MAX_BATCHES; round += 1) {
		const [, observations] = await db.batch([
			db
				.prepare(
					`DELETE FROM observability_observation_details WHERE (instance_id, observation_id) IN (${expired})`,
				)
				.bind(cutoff, PRUNE_BATCH_SIZE),
			db
				.prepare(
					`DELETE FROM observability_observations WHERE (instance_id, observation_id) IN (${expired})`,
				)
				.bind(cutoff, PRUNE_BATCH_SIZE),
		]);
		const changes = observations?.meta.changes ?? 0;
		deleted += changes;
		if (changes < PRUNE_BATCH_SIZE) break;
	}
	return deleted;
}
