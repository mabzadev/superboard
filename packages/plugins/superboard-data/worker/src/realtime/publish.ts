import type { RowChange } from "../database/records.js";
import type { TableDefinition } from "../database/schema.js";
import type { DataEnv, Deferral } from "../platform/env.js";
import type { PublishedChanges } from "./hub.js";

export function realtimeStub(env: DataEnv, projectId: number): DurableObjectStub | null {
	if (!env.REALTIME) return null;
	return env.REALTIME.get(env.REALTIME.idFromName(`project:${projectId}`));
}

export function publishChanges(
	env: DataEnv,
	deferral: Deferral,
	projectId: number,
	table: TableDefinition,
	changes: RowChange[],
): void {
	const stub = table.realtime && changes.length ? realtimeStub(env, projectId) : null;
	if (!stub) return;
	const body: PublishedChanges = { table: table.name, rule: table.rules.read, changes };
	deferral.waitUntil(
		stub.fetch("https://realtime.internal/publish", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

export function invalidateRealtime(env: DataEnv, deferral: Deferral, projectId: number): void {
	const stub = realtimeStub(env, projectId);
	if (stub)
		deferral.waitUntil(stub.fetch("https://realtime.internal/invalidate", { method: "POST" }));
}
