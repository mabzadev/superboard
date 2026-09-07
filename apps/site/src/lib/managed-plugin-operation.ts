import { sha256Canonical } from "@superboard/supbrd-core";
import type { APIContext } from "astro";
import { z } from "zod";

import { jsonResponse } from "./operator-guard.js";
import type { SuperBoardPluginTarget } from "./superboard-plugin-catalog.js";

export type SnapshotRow = Record<string, string | number | null>;
export type Snapshot = Record<string, SnapshotRow[]>;
const snapshotSchema = z.record(
	z.string(),
	z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
);
export function parseManagedPluginSnapshot(json: string): Snapshot {
	return snapshotSchema.parse(JSON.parse(json));
}
interface OperationScope {
	instance_id: string;
	target: SuperBoardPluginTarget;
}
export interface ManagedPluginOperation extends OperationScope {
	operation_id: string;
	owner_token: string;
}
interface StoredOperation extends ManagedPluginOperation {
	plugin_id: string;
	action: "enable" | "disable";
	status: "running" | "succeeded" | "failed";
	snapshot_json: string | null;
	snapshot_checksum: string | null;
	release_id: string | null;
	expires_at: string;
	response_status: number | null;
	response_json: string | null;
}
const snapshotIdentifierPattern = /^[a-z][a-z0-9_]*$/u;
const leaseMilliseconds = 5 * 60 * 1000;
const snapshotTables = [
	"superboard_plugin_staged_artifacts",
	"superboard_plugin_lifecycle",
	"superboard_plugin_runtime_health",
	"superboard_dependency_health",
	"superboard_plugin_target_artifacts",
] as const;

export async function beginManagedPluginOperation(
	db: D1Database,
	input: OperationScope & { operation_id: string; plugin_id: string; action: "enable" | "disable" },
): Promise<{ operation: ManagedPluginOperation } | { response: Response }> {
	const existing = await db
		.prepare("SELECT * FROM superboard_managed_plugin_operations WHERE operation_id = ?")
		.bind(input.operation_id)
		.first<StoredOperation>();
	if (existing) {
		if (
			existing.instance_id !== input.instance_id ||
			existing.target !== input.target ||
			existing.plugin_id !== input.plugin_id ||
			existing.action !== input.action
		) {
			return {
				response: jsonResponse({ error: { code: "PLUGIN_OPERATION_IDEMPOTENCY_CONFLICT" } }, 409),
			};
		}
		if (existing.status !== "running" && existing.response_json && existing.response_status) {
			return {
				response: new Response(existing.response_json, {
					status: existing.response_status,
					headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
				}),
			};
		}
	}
	const ownerToken = crypto.randomUUID();
	const now = new Date().toISOString();
	try {
		await db
			.prepare(`INSERT INTO superboard_managed_plugin_operations
   (operation_id, instance_id, target, plugin_id, action, status, owner_token, started_at, expires_at)
   VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`)
			.bind(
				input.operation_id,
				input.instance_id,
				input.target,
				input.plugin_id,
				input.action,
				ownerToken,
				now,
				new Date(Date.parse(now) + leaseMilliseconds).toISOString(),
			)
			.run();
	} catch (error) {
		if (!(error instanceof Error) || !error.message.includes("UNIQUE constraint failed"))
			throw error;
		return { response: jsonResponse({ error: { code: "PLUGIN_OPERATION_IN_PROGRESS" } }, 409) };
	}
	return { operation: { ...input, owner_token: ownerToken } };
}

export async function claimExpiredManagedPluginOperation(
	db: D1Database,
	instanceId: string,
): Promise<
	| (ManagedPluginOperation & {
			release_id: string | null;
			plugin_id: string;
			action: "enable" | "disable";
	  })
	| null
> {
	const ownerToken = crypto.randomUUID();
	const now = new Date().toISOString();
	return db
		.prepare(`UPDATE superboard_managed_plugin_operations SET owner_token = ?, expires_at = ?
 WHERE instance_id = ? AND status = 'running' AND expires_at <= ?
 RETURNING operation_id, instance_id, target, owner_token, release_id, plugin_id, action`)
		.bind(ownerToken, new Date(Date.parse(now) + leaseMilliseconds).toISOString(), instanceId, now)
		.first();
}

export async function renewManagedPluginOperation(
	db: D1Database,
	operation: ManagedPluginOperation,
) {
	const result = await db
		.prepare(`UPDATE superboard_managed_plugin_operations SET expires_at = ?
 WHERE operation_id = ? AND owner_token = ? AND status = 'running' AND expires_at > ?`)
		.bind(
			new Date(Date.now() + leaseMilliseconds).toISOString(),
			operation.operation_id,
			operation.owner_token,
			new Date().toISOString(),
		)
		.run();
	if (result.meta.changes !== 1) throw new Error("PLUGIN_OPERATION_OWNERSHIP_LOST");
}

export async function snapshotManagedPluginOperation(
	db: D1Database,
	operation: ManagedPluginOperation,
	releaseId: string,
) {
	const snapshot: Snapshot = {};
	for (const table of snapshotTables) {
		snapshot[table] = (
			await db
				.prepare(`SELECT * FROM ${table} WHERE instance_id = ?`)
				.bind(operation.instance_id)
				.all<SnapshotRow>()
		).results;
	}
	snapshot.superboard_front_active_releases = (
		await db
			.prepare("SELECT * FROM superboard_front_active_releases WHERE instance_id = ?")
			.bind(operation.instance_id)
			.all<SnapshotRow>()
	).results;
	snapshot.superboard_active_plugin_manifests = (
		await db
			.prepare(`SELECT manifest.* FROM superboard_active_plugin_manifests manifest
 WHERE EXISTS (SELECT 1 FROM superboard_plugin_lifecycle lifecycle WHERE lifecycle.plugin_id = manifest.plugin_id AND lifecycle.instance_id = ?)`)
			.bind(operation.instance_id)
			.all<SnapshotRow>()
	).results;
	try {
		snapshot._plugin_state = (
			await db
				.prepare(
					"SELECT plugin_id, version, status, activated_at, deactivated_at FROM _plugin_state WHERE plugin_id LIKE 'supbrd-%'",
				)
				.all<SnapshotRow>()
		).results;
	} catch (error) {
		if (!(error instanceof Error) || !error.message.includes("no such table: _plugin_state"))
			throw error;
	}
	await db
		.prepare(`UPDATE superboard_managed_plugin_operations SET snapshot_json = ?, snapshot_checksum = ?, release_id = ?
 WHERE operation_id = ? AND owner_token = ? AND status = 'running'`)
		.bind(
			JSON.stringify(snapshot),
			await sha256Canonical(snapshot),
			releaseId,
			operation.operation_id,
			operation.owner_token,
		)
		.run();
}

export async function restoreManagedPluginOperation(
	db: D1Database,
	operation: ManagedPluginOperation,
): Promise<Array<{ plugin_id: string; status: "active" | "inactive" }>> {
	const stored = await db
		.prepare(
			"SELECT * FROM superboard_managed_plugin_operations WHERE operation_id = ? AND owner_token = ? AND status = 'running'",
		)
		.bind(operation.operation_id, operation.owner_token)
		.first<StoredOperation>();
	if (!stored?.snapshot_json) return [];
	const active = await db
		.prepare("SELECT active_release_id FROM superboard_front_active_releases WHERE instance_id = ?")
		.bind(operation.instance_id)
		.first<{ active_release_id: string }>();
	if (stored.release_id === active?.active_release_id)
		throw new Error("PLUGIN_OPERATION_ALREADY_COMMITTED");
	const snapshot = parseManagedPluginSnapshot(stored.snapshot_json);
	if ((await sha256Canonical(snapshot)) !== stored.snapshot_checksum)
		throw new Error("PLUGIN_OPERATION_SNAPSHOT_INVALID");
	const statements = managedPluginRestoreStatements(db, operation, snapshot);
	await db.batch(statements);
	return (snapshot.superboard_plugin_lifecycle ?? []).flatMap((row) =>
		typeof row.plugin_id === "string"
			? [
					{
						plugin_id: row.plugin_id,
						status: row.state === "active" ? ("active" as const) : ("inactive" as const),
					},
				]
			: [],
	);
}

export async function completeManagedPluginOperation(
	db: D1Database,
	operation: ManagedPluginOperation,
	response: Response,
) {
	await db
		.prepare(`UPDATE superboard_managed_plugin_operations SET status = ?, response_status = ?, response_json = ?, completed_at = ?
 WHERE operation_id = ? AND owner_token = ? AND status = 'running'`)
		.bind(
			response.ok ? "succeeded" : "failed",
			response.status,
			await response.clone().text(),
			new Date().toISOString(),
			operation.operation_id,
			operation.owner_token,
		)
		.run();
}

function insertSnapshotRow(db: D1Database, table: string, row: SnapshotRow) {
	const keys = Object.keys(row);
	if (![table, ...keys].every((key) => snapshotIdentifierPattern.test(key)))
		throw new Error("PLUGIN_OPERATION_SNAPSHOT_INVALID");
	return db
		.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
		.bind(...keys.map((key) => row[key]));
}

const managedOperationContextKey = Symbol.for("superboard:managed-plugin-operation");
type OperationContext = APIContext & { [managedOperationContextKey]?: ManagedPluginOperation };
export function bindManagedPluginOperation(
	context: APIContext,
	operation: ManagedPluginOperation,
): APIContext {
	return { ...context, [managedOperationContextKey]: operation } as OperationContext;
}
export async function requireManagedPluginOperationAccess(
	context: APIContext,
	db: D1Database,
	instanceId: string,
): Promise<Response | null> {
	const active = await db
		.prepare(
			"SELECT operation_id, owner_token, expires_at FROM superboard_managed_plugin_operations WHERE instance_id = ? AND status = 'running'",
		)
		.bind(instanceId)
		.first<{ operation_id: string; owner_token: string; expires_at: string }>();
	if (!active) return null;
	const operation = (context as OperationContext)[managedOperationContextKey];
	return operation?.operation_id === active.operation_id &&
		operation.owner_token === active.owner_token &&
		Date.parse(active.expires_at) > Date.now()
		? null
		: jsonResponse({ error: { code: "PLUGIN_OPERATION_IN_PROGRESS" } }, 409);
}

export function managedPluginRestoreStatements(
	db: D1Database,
	operation: ManagedPluginOperation,
	snapshot: Snapshot,
): D1PreparedStatement[] {
	const statements: D1PreparedStatement[] = [
		db
			.prepare(`DELETE FROM superboard_active_plugin_manifests WHERE plugin_id IN
 (SELECT plugin_id FROM superboard_plugin_lifecycle WHERE instance_id = ?)`)
			.bind(operation.instance_id),
	];
	for (const table of snapshotTables) {
		statements.push(
			db.prepare(`DELETE FROM ${table} WHERE instance_id = ?`).bind(operation.instance_id),
		);
		for (const row of snapshot[table] ?? []) statements.push(insertSnapshotRow(db, table, row));
	}
	for (const row of snapshot.superboard_active_plugin_manifests ?? [])
		statements.push(insertSnapshotRow(db, "superboard_active_plugin_manifests", row));
	for (const row of snapshot._plugin_state ?? []) {
		statements.push(
			db
				.prepare(
					"UPDATE _plugin_state SET version = ?, status = ?, activated_at = ?, deactivated_at = ? WHERE plugin_id = ?",
				)
				.bind(row.version, row.status, row.activated_at, row.deactivated_at, row.plugin_id),
		);
	}
	return statements;
}

export function managedPluginOperationFromContext(
	context: APIContext,
): ManagedPluginOperation | undefined {
	return (context as OperationContext)[managedOperationContextKey];
}
