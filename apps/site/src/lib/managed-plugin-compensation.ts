import { sha256Canonical } from "@superboard/supbrd-core";
import type { APIContext } from "astro";

import {
	managedPluginRestoreStatements,
	renewManagedPluginOperation,
	type ManagedPluginOperation,
	parseManagedPluginSnapshot,
} from "./managed-plugin-operation.js";
import { syncPluginPackageRuntime } from "./plugin-package-state.js";
import { loadLastVerifiedFrontRelease } from "./release-source.js";
import { getSiteEnv } from "./site-env.js";

export async function compensateManagedPluginActivation(
	context: APIContext,
	operation: ManagedPluginOperation,
): Promise<void> {
	const env = getSiteEnv();
	await renewManagedPluginOperation(env.DB, operation);
	const stored =
		await env.DB.prepare(`SELECT snapshot_json, snapshot_checksum, release_id, plugin_id FROM superboard_managed_plugin_operations
 WHERE operation_id = ? AND owner_token = ? AND status = 'running'`)
			.bind(operation.operation_id, operation.owner_token)
			.first<{
				snapshot_json: string;
				snapshot_checksum: string;
				release_id: string;
				plugin_id: string;
			}>();
	if (!stored?.snapshot_json || !stored.release_id)
		throw new Error("PLUGIN_COMPENSATION_SNAPSHOT_MISSING");
	const snapshot = parseManagedPluginSnapshot(stored.snapshot_json);
	if ((await sha256Canonical(snapshot)) !== stored.snapshot_checksum)
		throw new Error("PLUGIN_COMPENSATION_SNAPSHOT_INVALID");
	const previous = snapshot.superboard_front_active_releases?.[0];
	const previousId =
		typeof previous?.active_release_id === "string" ? previous.active_release_id : null;
	const compensationId = `plugin-compensation:${operation.operation_id}`;
	const active = await env.DB.prepare(
		"SELECT active_release_id, pointer_revision FROM superboard_front_active_releases WHERE instance_id = ?",
	)
		.bind(operation.instance_id)
		.first<{ active_release_id: string; pointer_revision: number }>();
	const existing = await env.DB.prepare(
		"SELECT status FROM superboard_plugin_compensations WHERE compensation_id = ?",
	)
		.bind(compensationId)
		.first<{ status: string }>();
	if (existing?.status !== "completed") {
		if (active?.active_release_id !== stored.release_id)
			throw new Error("PLUGIN_COMPENSATION_POINTER_CHANGED");
		const authorization =
			await env.DB.prepare(`SELECT receipt.receipt_id, receipt.operator_id FROM superboard_front_activation_reauthentication linked
   JOIN superboard_operator_reauthentication_receipts receipt ON receipt.receipt_id = linked.receipt_id
   WHERE linked.activation_id = ? AND receipt.instance_id = ? AND receipt.action = 'front_release.activate'`)
				.bind(`plugin:${operation.operation_id}`, operation.instance_id)
				.first<{ receipt_id: string; operator_id: string }>();
		if (!authorization) throw new Error("PLUGIN_COMPENSATION_AUTHORIZATION_MISSING");
		const now = new Date().toISOString();
		const checksum = await sha256Canonical(snapshot);
		const statements = [
			env.DB.prepare(`INSERT INTO superboard_plugin_compensations
   (compensation_id, owner_token, operation_id, instance_id, from_release_id, target_release_id, expected_pointer_revision, snapshot_checksum, operator_id, authorization_receipt_id, reason, status, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'activation finalization failed', 'prepared', ?)
   ON CONFLICT(compensation_id) DO UPDATE SET status = 'prepared', owner_token = excluded.owner_token WHERE status = 'recovery_required'`).bind(
				compensationId,
				operation.owner_token,
				operation.operation_id,
				operation.instance_id,
				stored.release_id,
				previousId,
				active.pointer_revision,
				checksum,
				authorization.operator_id,
				authorization.receipt_id,
				now,
			),
		];
		if (previousId) {
			statements.push(
				env.DB.prepare(`UPDATE superboard_front_active_releases SET active_release_id = ?, previous_release_id = ?, pointer_revision = pointer_revision + 1, activation_id = ?, activated_at = ?
    WHERE instance_id = ? AND active_release_id = ? AND pointer_revision = ?`).bind(
					previousId,
					stored.release_id,
					compensationId,
					now,
					operation.instance_id,
					stored.release_id,
					active.pointer_revision,
				),
			);
		} else {
			statements.push(
				env.DB.prepare(
					"DELETE FROM superboard_front_active_releases WHERE instance_id = ? AND active_release_id = ? AND pointer_revision = ?",
				).bind(operation.instance_id, stored.release_id, active.pointer_revision),
			);
		}
		statements.push(
			env.DB.prepare(`INSERT INTO superboard_plugin_lifecycle_events
   (instance_id, target, plugin_id, artifact_checksum, from_state, to_state, plan_id, release_id, reason, changed_at)
   SELECT lifecycle.instance_id, lifecycle.target, lifecycle.plugin_id,
    COALESCE(json_extract(previous.value, '$.artifact_checksum'), lifecycle.artifact_checksum), lifecycle.state,
    COALESCE(json_extract(previous.value, '$.state'), 'available'), lifecycle.plan_id, ?, 'activation compensation', ?
   FROM superboard_plugin_lifecycle lifecycle
   LEFT JOIN json_each(?) previous ON json_extract(previous.value, '$.plugin_id') = lifecycle.plugin_id
    AND json_extract(previous.value, '$.target') = lifecycle.target
   WHERE lifecycle.instance_id = ? AND lifecycle.state <> COALESCE(json_extract(previous.value, '$.state'), 'available')`).bind(
				previousId,
				now,
				JSON.stringify(snapshot.superboard_plugin_lifecycle ?? []),
				operation.instance_id,
			),
		);
		statements.push(...managedPluginRestoreStatements(env.DB, operation, snapshot));
		if (
			snapshot._plugin_state &&
			!snapshot._plugin_state.some((row) => row.plugin_id === stored.plugin_id)
		) {
			statements.push(
				env.DB.prepare(
					"UPDATE _plugin_state SET status = 'inactive', activated_at = NULL, deactivated_at = ? WHERE plugin_id = ?",
				).bind(now, stored.plugin_id),
			);
		}
		statements.push(
			env.DB.prepare(`INSERT INTO superboard_front_outbox (event_type, instance_id, release_id, pointer_revision, payload_json, created_at)
   VALUES ('plugin_activation.compensated', ?, ?, ?, ?, ?)`).bind(
				operation.instance_id,
				previousId ?? stored.release_id,
				active.pointer_revision + 1,
				JSON.stringify({
					compensation_id: compensationId,
					operation_id: operation.operation_id,
					from_release_id: stored.release_id,
					restored_release_id: previousId,
					snapshot_checksum: checksum,
				}),
				now,
			),
		);
		statements.push(
			env.DB.prepare(
				"UPDATE superboard_plugin_compensations SET status = 'completed', completed_at = ? WHERE compensation_id = ?",
			).bind(now, compensationId),
		);
		await env.DB.batch(statements);
	}
	await env.RELEASE_CACHE.delete(`last_verified_release:${operation.instance_id}`);
	if (previousId) {
		const restored = await loadLastVerifiedFrontRelease(env, operation.instance_id);
		if (restored?.release.payload.release_id !== previousId)
			throw new Error("PLUGIN_COMPENSATION_CACHE_NOT_RESTORED");
	}
	await syncPluginPackageRuntime(
		env.DB,
		{ instance_id: operation.instance_id, target: operation.target },
		context.locals.emdash,
	);
}
