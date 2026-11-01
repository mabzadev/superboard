const FINISHED_PLUGIN_TASK_LEASE_RETENTION_MS = 86_400_000;
const FINISH_PRUNE_LIMIT = 20;
const PRUNE_BATCH_SIZE = 1000;
const PRUNE_MAX_BATCHES = 20;

// Running leases are never removed: they are the proof that blocks plugin disablement.
export function finishedPluginTaskLeaseRetention(
	db: Pick<D1Database, "prepare">,
	scope: { instanceId: string; target: string; pluginId: string },
	now = Date.now(),
): D1PreparedStatement {
	// Each finish removes a few expired siblings through the running-lease index, bounding the table.
	return db
		.prepare(
			"DELETE FROM superboard_plugin_task_leases WHERE lease_id IN (SELECT lease_id FROM superboard_plugin_task_leases WHERE instance_id = ? AND target = ? AND plugin_id = ? AND state = 'finished' AND finished_at < ? LIMIT ?)",
		)
		.bind(
			scope.instanceId,
			scope.target,
			scope.pluginId,
			new Date(now - FINISHED_PLUGIN_TASK_LEASE_RETENTION_MS).toISOString(),
			FINISH_PRUNE_LIMIT,
		);
}

export async function pruneFinishedPluginTaskLeases(
	db: D1Database,
	now = Date.now(),
): Promise<number> {
	const cutoff = new Date(now - FINISHED_PLUGIN_TASK_LEASE_RETENTION_MS).toISOString();
	let deleted = 0;
	for (let round = 0; round < PRUNE_MAX_BATCHES; round += 1) {
		const result = await db
			.prepare(
				"DELETE FROM superboard_plugin_task_leases WHERE lease_id IN (SELECT lease_id FROM superboard_plugin_task_leases WHERE state = 'finished' AND finished_at < ? LIMIT ?)",
			)
			.bind(cutoff, PRUNE_BATCH_SIZE)
			.run();
		const changes = result.meta.changes ?? 0;
		deleted += changes;
		if (changes < PRUNE_BATCH_SIZE) break;
	}
	return deleted;
}
