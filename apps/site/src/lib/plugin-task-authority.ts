import { pluginPackageOwner } from "@superboard/contracts/plugin-packages";
import { parsePluginTaskCommand, verifyPluginTaskRequest } from "@superboard/contracts/plugin-task";
import { readJsonObjectLimited, RequestBodyError } from "@superboard/contracts/request-body";

import { jsonResponse } from "./operator-guard.js";
import type { SuperBoardSiteEnv } from "./site-env.js";
import {
	resolveSuperBoardPluginTarget,
	superBoardRuntimePluginCatalog,
} from "./superboard-plugin-catalog.js";

export async function handlePluginTaskAuthority(
	request: Request,
	env: SuperBoardSiteEnv,
): Promise<Response> {
	try {
		if (!(await verifyPluginTaskRequest(request, env.SITE_OPERATOR_BRIDGE_TOKEN ?? "")))
			return jsonResponse({ error: { code: "PLUGIN_TASK_AUTHENTICATION_REQUIRED" } }, 401);
		const command = parsePluginTaskCommand(await readJsonObjectLimited(request, 16384));
		if (!command) return jsonResponse({ error: { code: "PLUGIN_TASK_REQUEST_INVALID" } }, 422);
		if (command.instance_id !== env.SUPERBOARD_INSTANCE_ID)
			return jsonResponse({ error: { code: "PLUGIN_TASK_INSTANCE_FORBIDDEN" } }, 403);
		if (
			command.plugin_id !== "supbrd-core" &&
			!superBoardRuntimePluginCatalog().plugins.some(
				({ manifest }) => manifest.plugin_id === command.plugin_id,
			)
		)
			return jsonResponse({ error: { code: "PLUGIN_NOT_ACTIVE" } }, 404);
		const db = env.DB.withSession("first-primary");
		const target = resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT);
		if (command.action === "wakeups") {
			const waiters = await db
				.prepare(`SELECT waiter.waiter_id, waiter.plugin_id, waiter.workflow_binding, waiter.workflow_id, waiter.event_type
    FROM superboard_plugin_workflow_waiters waiter
    JOIN superboard_plugin_lifecycle lifecycle ON lifecycle.instance_id = waiter.instance_id AND lifecycle.target = waiter.target AND lifecycle.plugin_id = waiter.plugin_id
    WHERE waiter.instance_id = ? AND waiter.target = ? AND waiter.state = 'pending' AND lifecycle.state = 'active'
     AND NOT EXISTS(SELECT 1 FROM superboard_managed_plugin_operations operation WHERE operation.instance_id = waiter.instance_id AND operation.status = 'running')
    ORDER BY waiter.created_at LIMIT 25`)
				.bind(command.instance_id, target)
				.all();
			return jsonResponse({ waiters: waiters.results });
		}
		if (command.action === "wake_done") {
			await db
				.prepare(
					"UPDATE superboard_plugin_workflow_waiters SET state = 'notified', notified_at = ? WHERE waiter_id = ? AND instance_id = ? AND target = ? AND state = 'pending'",
				)
				.bind(new Date().toISOString(), command.waiter_id, command.instance_id, target)
				.run();
			return jsonResponse({ notified: true });
		}
		const tokenChecksum = Array.from(
			new Uint8Array(
				await crypto.subtle.digest("SHA-256", new TextEncoder().encode(command.lease_token)),
			),
			(byte) => byte.toString(16).padStart(2, "0"),
		).join("");
		const now = new Date().toISOString();
		if (command.action === "claim") {
			const deadline = new Date(Date.now() + command.duration_ms!).toISOString();
			const inserted = await db
				.prepare(`INSERT INTO superboard_plugin_task_leases
    (lease_id, instance_id, target, plugin_id, task_id, kind, token_checksum, state, release_id, started_at, deadline_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, 'running', (SELECT active_release_id FROM superboard_front_active_releases WHERE instance_id = ?), ?, ?
    WHERE ? = 'supbrd-core' OR ? = 'retention' OR (
     EXISTS(SELECT 1 FROM superboard_plugin_lifecycle WHERE instance_id = ? AND target = ? AND plugin_id = ? AND state = 'active')
     AND NOT EXISTS(SELECT 1 FROM superboard_managed_plugin_operations WHERE instance_id = ? AND plugin_id IN (?,?) AND status = 'running')
    ) ON CONFLICT(lease_id) DO NOTHING RETURNING lease_id, deadline_at`)
				.bind(
					command.lease_id,
					command.instance_id,
					target,
					command.plugin_id,
					command.task_id,
					command.kind,
					tokenChecksum,
					command.instance_id,
					now,
					deadline,
					command.plugin_id,
					command.kind,
					command.instance_id,
					target,
					command.plugin_id,
					command.instance_id,
					command.plugin_id,
					pluginPackageOwner(command.plugin_id),
				)
				.first<{ lease_id: string; deadline_at: string }>();
			if (inserted) return jsonResponse({ ...inserted, state: "running" }, 201);
			const existing = await db
				.prepare(
					"SELECT instance_id, target, plugin_id, token_checksum, task_id, kind, state, deadline_at FROM superboard_plugin_task_leases WHERE lease_id = ?",
				)
				.bind(command.lease_id)
				.first<{
					instance_id: string;
					target: string;
					plugin_id: string;
					token_checksum: string;
					task_id: string;
					kind: string;
					state: string;
					deadline_at: string;
				}>();
			if (!existing) {
				if (command.kind === "workflow") {
					const waiterId = Array.from(
						new Uint8Array(
							await crypto.subtle.digest(
								"SHA-256",
								new TextEncoder().encode(
									JSON.stringify([
										command.instance_id,
										command.plugin_id,
										command.workflow_binding,
										command.workflow_id,
										command.resume_event,
									]),
								),
							),
						),
						(byte) => byte.toString(16).padStart(2, "0"),
					).join("");
					await db
						.prepare(`INSERT INTO superboard_plugin_workflow_waiters (waiter_id, instance_id, target, plugin_id, workflow_binding, workflow_id, event_type, state, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?) ON CONFLICT(waiter_id) DO UPDATE SET state = 'pending', notified_at = NULL`)
						.bind(
							waiterId,
							command.instance_id,
							target,
							command.plugin_id,
							command.workflow_binding,
							command.workflow_id,
							command.resume_event,
							now,
						)
						.run();
				}
				return jsonResponse({ error: { code: "PLUGIN_NOT_ACTIVE" } }, 404);
			}
			if (
				existing.instance_id !== command.instance_id ||
				existing.target !== target ||
				existing.plugin_id !== command.plugin_id ||
				existing.token_checksum !== tokenChecksum ||
				existing.task_id !== command.task_id ||
				existing.kind !== command.kind
			)
				return jsonResponse({ error: { code: "PLUGIN_TASK_LEASE_CONFLICT" } }, 409);
			if (existing.state !== "running" || existing.deadline_at <= now)
				return jsonResponse({ error: { code: "PLUGIN_TASK_LEASE_FINISHED" } }, 409);
			return jsonResponse({
				lease_id: command.lease_id,
				deadline_at: existing.deadline_at,
				state: existing.state,
			});
		}
		const lease = await db
			.prepare(
				"SELECT state, deadline_at FROM superboard_plugin_task_leases WHERE lease_id = ? AND instance_id = ? AND target = ? AND plugin_id = ? AND token_checksum = ?",
			)
			.bind(command.lease_id, command.instance_id, target, command.plugin_id, tokenChecksum)
			.first<{ state: string; deadline_at: string }>();
		if (!lease) return jsonResponse({ error: { code: "PLUGIN_TASK_LEASE_FORBIDDEN" } }, 403);
		if (command.action === "check") {
			if (lease.state !== "running" || lease.deadline_at <= now)
				return jsonResponse({ error: { code: "PLUGIN_TASK_DEADLINE_EXCEEDED" } }, 409);
			return jsonResponse({
				lease_id: command.lease_id,
				state: "running",
				deadline_at: lease.deadline_at,
			});
		}
		await db
			.prepare(
				"UPDATE superboard_plugin_task_leases SET state = 'finished', finished_at = ? WHERE lease_id = ? AND state = 'running'",
			)
			.bind(now, command.lease_id)
			.run();
		return jsonResponse({ lease_id: command.lease_id, state: "finished" });
	} catch (error) {
		if (error instanceof RequestBodyError)
			return jsonResponse({ error: { code: "PLUGIN_TASK_REQUEST_INVALID" } }, error.status);
		console.error("[plugin-task-authority] request failed", error);
		return jsonResponse({ error: { code: "PLUGIN_TASK_AUTHORITY_UNAVAILABLE" } }, 503);
	}
}
