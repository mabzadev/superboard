import { readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export async function recoverStoppedLocalPluginTasks({ directory, instanceId, ports }) {
	if (!instanceId || !ports.length) throw new Error("LOCAL_RECOVERY_SCOPE_REQUIRED");
	const reservations = [];
	try {
		for (const port of new Set(ports)) {
			const server = createServer();
			await new Promise((resolve, reject) => {
				server.once("error", (cause) =>
					reject(new Error("LOCAL_RUNTIME_STILL_RUNNING", { cause })),
				);
				server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
			});
			reservations.push(server);
		}
		const entries = await readdir(directory, { recursive: true }).catch((error) => {
			if (error.code === "ENOENT") return [];
			throw error;
		});
		let recovered = 0;
		for (const entry of entries) {
			if (!entry.endsWith(".sqlite")) continue;
			const db = new DatabaseSync(join(directory, entry));
			try {
				if (
					!db
						.prepare(
							"SELECT 1 FROM sqlite_master WHERE type='table' AND name='superboard_plugin_task_leases'",
						)
						.get()
				)
					continue;
				recovered += Number(
					db
						.prepare(
							"UPDATE superboard_plugin_task_leases SET state='finished', finished_at=? WHERE instance_id=? AND target='local' AND state='running'",
						)
						.run(new Date().toISOString(), instanceId).changes,
				);
			} finally {
				db.close();
			}
		}
		return recovered;
	} finally {
		await Promise.all(
			reservations.map(
				(server) =>
					new Promise((resolve) => {
						server.close(resolve);
					}),
			),
		);
	}
}
