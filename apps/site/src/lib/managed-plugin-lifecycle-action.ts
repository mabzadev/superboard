import type { APIContext, APIRoute } from "astro";

import { POST as synchronizePlugins } from "../pages/_superboard/api/plugins/sync.js";
import { POST as activateRelease } from "../pages/_superboard/api/releases/activate.js";
import { POST as approveRelease } from "../pages/_superboard/api/releases/approve.js";
import { POST as compileRelease } from "../pages/_superboard/api/releases/compile.js";
import { POST as createUserSlice } from "../pages/_superboard/api/releases/user-slice.js";
import { compensateManagedPluginActivation } from "./managed-plugin-compensation.js";
import {
	beginManagedPluginOperation,
	bindManagedPluginOperation,
	claimExpiredManagedPluginOperation,
	completeManagedPluginOperation,
	renewManagedPluginOperation,
	restoreManagedPluginOperation,
	snapshotManagedPluginOperation,
	type ManagedPluginOperation,
} from "./managed-plugin-operation.js";
import {
	jsonResponse,
	recentOperatorReauthentication,
	requireReleaseOperator,
	withLocalOperatorReauthentication,
} from "./operator-guard.js";
import { wakePendingPluginWorkflows } from "./plugin-task-wakeup.js";
import { getSiteEnv } from "./site-env.js";
import {
	loadActiveSuperBoardPluginIdsRequiringValidation,
	superBoardRuntimePluginCatalog,
	resolveSuperBoardPluginTarget,
	reconcileSuperBoardPluginStatus,
	stageSuperBoardPluginDependencyHealth,
	transitionSuperBoardPluginLifecycle,
} from "./superboard-plugin-catalog.js";

const operationIdPattern = /^[A-Za-z0-9._:-]{8,200}$/u;

type ManagedPluginLifecycleAction = "enable" | "disable";

export async function runManagedPluginLifecycleAction(
	context: APIContext,
	action: ManagedPluginLifecycleAction,
): Promise<Response> {
	const env = getSiteEnv();
	const denied = requireReleaseOperator(context, env);
	if (denied) return denied;
	const pluginId = context.params.pluginId ?? "";
	if (
		!superBoardRuntimePluginCatalog().plugins.some(
			({ manifest }) => manifest.plugin_id === pluginId,
		)
	) {
		return jsonResponse({ error: { code: "PLUGIN_NOT_FOUND" } }, 404);
	}
	const target = resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT);
	const operationId = context.request.headers.get("Idempotency-Key") ?? crypto.randomUUID();
	if (!operationIdPattern.test(operationId))
		return jsonResponse({ error: { code: "INVALID_IDEMPOTENCY_KEY" } }, 422);
	if (!(await recoverExpiredManagedPluginOperation(context)))
		return jsonResponse({ error: { code: "PLUGIN_RECOVERY_REQUIRED" } }, 503);
	const started = await beginManagedPluginOperation(env.DB, {
		operation_id: operationId,
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		target,
		plugin_id: pluginId,
		action,
	});
	if ("response" in started) return started.response;
	const { operation } = started;
	const releaseId = localId();
	let response: Response;
	try {
		const current = await env.DB.prepare(`SELECT state FROM superboard_plugin_lifecycle
   WHERE instance_id = ? AND target = ? AND plugin_id = ?`)
			.bind(operation.instance_id, target, pluginId)
			.first<{ state: string }>();
		const stale = await loadActiveSuperBoardPluginIdsRequiringValidation(env.DB, {
			...operation,
			checked_at: new Date().toISOString(),
			target_artifact_checksum: env.TARGET_ARTIFACT_CHECKSUM,
		});
		if (
			(action === "enable" && current?.state === "active" && !stale.includes(pluginId)) ||
			(action === "disable" &&
				(!current || ["available", "installed", "disabled"].includes(current.state)))
		) {
			const active = await env.DB.prepare(
				"SELECT active_release_id FROM superboard_front_active_releases WHERE instance_id = ?",
			)
				.bind(operation.instance_id)
				.first<{ active_release_id: string }>();
			await reconcileSuperBoardPluginStatus(
				env.DB,
				pluginId,
				action === "enable" ? "active" : "inactive",
				new Date().toISOString(),
			);
			await context.locals.emdash.setPluginStatus(
				pluginId,
				action === "enable" ? "active" : "inactive",
			);
			response = jsonResponse(
				{
					plugin_id: pluginId,
					status: action === "enable" ? "active" : "disabled",
					release_id: active?.active_release_id ?? null,
				},
				200,
			);
		} else {
			await snapshotManagedPluginOperation(env.DB, operation, releaseId);
			response = await executeManagedPluginLifecycleAction(context, action, operation, releaseId);
			if (!response.ok) {
				const restored = await restoreManagedPluginOperation(env.DB, operation);
				for (const plugin of restored)
					await context.locals.emdash.setPluginStatus(plugin.plugin_id, plugin.status);
			}
		}
	} catch (error) {
		console.error("[managed-plugin-lifecycle] operation failed", error);
		const active = await env.DB.prepare(
			"SELECT active_release_id FROM superboard_front_active_releases WHERE instance_id = ?",
		)
			.bind(operation.instance_id)
			.first<{ active_release_id: string }>();
		if (active?.active_release_id === releaseId) {
			try {
				await compensateManagedPluginActivation(context, operation);
				response = jsonResponse({ error: { code: "PLUGIN_ACTIVATION_COMPENSATED" } }, 500);
			} catch (compensationError) {
				console.error(
					"[managed-plugin-lifecycle] compensation requires recovery",
					compensationError,
				);
				await markManagedPluginRecoveryRequired(env.DB, operation);
				return jsonResponse({ error: { code: "PLUGIN_RECOVERY_REQUIRED" } }, 503);
			}
		} else {
			const restored = await restoreManagedPluginOperation(env.DB, operation);
			for (const plugin of restored)
				await context.locals.emdash.setPluginStatus(plugin.plugin_id, plugin.status);
			response = jsonResponse({ error: { code: "PLUGIN_LIFECYCLE_ACTION_FAILED" } }, 500);
		}
	}
	await completeManagedPluginOperation(env.DB, operation, response);
	await wakePendingPluginWorkflows();
	return response;
}

async function executeManagedPluginLifecycleAction(
	context: APIContext,
	action: ManagedPluginLifecycleAction,
	operation: ManagedPluginOperation,
	releaseId: string,
): Promise<Response> {
	const env = getSiteEnv();
	const denied = requireReleaseOperator(context, env);
	if (denied) return denied;
	const pluginId = context.params.pluginId;
	if (!pluginId || !pluginId.startsWith("supbrd-") || pluginId.includes("*")) {
		return jsonResponse({ error: { code: "INVALID_PLUGIN_ID" } }, 422);
	}

	const candidateId = localId();
	const reauthenticationInput = {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		candidate_id: candidateId,
		action: "front_release.approve" as const,
		now: new Date().toISOString(),
	};
	let workflowContext = bindManagedPluginOperation(context, operation);
	let reauthentication = await recentOperatorReauthentication(
		workflowContext,
		reauthenticationInput,
	);
	if (!reauthentication && env.SUPERBOARD_ENVIRONMENT === "local" && context.locals.user) {
		workflowContext = withLocalOperatorReauthentication(
			workflowContext,
			env,
			reauthenticationInput.now,
		);
		reauthentication = await recentOperatorReauthentication(workflowContext, reauthenticationInput);
	}
	if (!reauthentication) {
		return jsonResponse({ error: { code: "STRONG_REAUTH_REQUIRED" } }, 403);
	}

	const target = resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT ?? "local");
	const identifiers = {
		front_draft_id: localId(),
		draft_snapshot_id: localId(),
		compilation_id: localId(),
		candidate_id: candidateId,
		release_id: releaseId,
	};
	const checkedAt = new Date().toISOString();
	const stalePluginIds = await loadActiveSuperBoardPluginIdsRequiringValidation(env.DB, {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		target,
		checked_at: checkedAt,
		target_artifact_checksum: env.TARGET_ARTIFACT_CHECKSUM,
	});
	const pluginIds = [
		...new Set([
			...stalePluginIds.filter((id) => action !== "disable" || id !== pluginId),
			...(action === "enable" ? [pluginId] : []),
		]),
	];
	if (pluginIds.length > 0) {
		await renewManagedPluginOperation(env.DB, operation);
		const synchronized = await invoke(synchronizePlugins, workflowContext, "plugins/sync", {
			plan_id: `plugin-${action}-${crypto.randomUUID()}`,
			expires_in_hours: 1,
			plugin_ids: pluginIds,
		});
		if (!synchronized.ok) return synchronized;

		await Promise.all(
			pluginIds.map((refreshedPluginId) =>
				stageSuperBoardPluginDependencyHealth(env.DB, {
					instance_id: env.SUPERBOARD_INSTANCE_ID,
					target,
					plugin_id: refreshedPluginId,
					checked_at: checkedAt,
				}),
			),
		);
	}

	await renewManagedPluginOperation(env.DB, operation);
	const sliced = await invoke(createUserSlice, workflowContext, "releases/user-slice", {
		...identifiers,
		...(action === "enable" ? { plugin_ids: [pluginId] } : { excluded_plugin_ids: [pluginId] }),
	});
	if (!sliced.ok) return sliced;
	const slice = await sliced.clone().json<{
		previous_release_id: string | null;
	}>();

	const compiledResponse = await invoke(compileRelease, workflowContext, "releases/compile", {
		draft_snapshot_id: identifiers.draft_snapshot_id,
	});
	if (!compiledResponse.ok) return compiledResponse;
	const compiled = await compiledResponse.clone().json<{
		validation_receipts: Array<{ level: string; receipt_id: string }>;
	}>();

	const approved = await invoke(approveRelease, workflowContext, "releases/approve", {
		candidate_id: identifiers.candidate_id,
		warnings_acknowledged: compiled.validation_receipts
			.filter(({ level }) => level === "warning")
			.map(({ receipt_id: receiptId }) => receiptId),
	});
	if (!approved.ok) return approved;

	if (action === "disable") {
		await transitionSuperBoardPluginLifecycle(env.DB, {
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			target,
			plugin_id: pluginId,
			to_state: "draining",
			changed_at: new Date().toISOString(),
			reason: "operator disable",
		});
		const busy = await env.DB.prepare(`SELECT
   EXISTS(SELECT 1 FROM superboard_plugin_command_operations WHERE instance_id = ? AND plugin_id = ? AND state = 'accepted')
   OR EXISTS(SELECT 1 FROM superboard_worker_execution_leases WHERE plugin_id = ? AND consumed_at IS NULL AND superseded_at IS NULL AND expires_at > ?)
   OR EXISTS(SELECT 1 FROM superboard_plugin_task_leases WHERE instance_id = ? AND target = ? AND plugin_id = ? AND state = 'running') AS busy`)
			.bind(
				env.SUPERBOARD_INSTANCE_ID,
				pluginId,
				pluginId,
				new Date().toISOString(),
				env.SUPERBOARD_INSTANCE_ID,
				target,
				pluginId,
			)
			.first<{ busy: number }>();
		if (busy?.busy) return jsonResponse({ error: { code: "PLUGIN_OPERATIONS_IN_PROGRESS" } }, 409);
		await workflowContext.locals.emdash.setPluginStatus(pluginId, "inactive");
	}

	await renewManagedPluginOperation(env.DB, operation);
	const activated = await invoke(activateRelease, workflowContext, "releases/activate", {
		candidate_id: identifiers.candidate_id,
		activation_id: `plugin:${operation.operation_id}`,
		expected_active_release_id: slice.previous_release_id,
	});
	if (!activated.ok) return activated;
	return jsonResponse(
		{
			plugin_id: pluginId,
			status: action === "enable" ? "active" : "disabled",
			release_id: identifiers.release_id,
		},
		201,
	);
}

async function invoke(
	handler: APIRoute,
	context: APIContext,
	path: string,
	body: unknown,
): Promise<Response> {
	const url = new URL(`/_emdash/api/superboard/${path}`, context.url.origin);
	const headers = new Headers(context.request.headers);
	headers.delete("content-length");
	headers.set("Content-Type", "application/json");
	return await handler({
		...context,
		url,
		request: new Request(url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		}),
		params: {},
	});
}

function localId(): string {
	return `0${crypto.randomUUID().replaceAll("-", "").slice(0, 25).toUpperCase()}`;
}

async function recoverExpiredManagedPluginOperation(context: APIContext) {
	const env = getSiteEnv();
	const operation = await claimExpiredManagedPluginOperation(env.DB, env.SUPERBOARD_INSTANCE_ID);
	if (!operation) return true;
	const active = await env.DB.prepare(
		"SELECT active_release_id FROM superboard_front_active_releases WHERE instance_id = ?",
	)
		.bind(operation.instance_id)
		.first<{ active_release_id: string }>();
	try {
		let response: Response;
		const compensation = await env.DB.prepare(
			"SELECT compensation_id FROM superboard_plugin_compensations WHERE operation_id = ?",
		)
			.bind(operation.operation_id)
			.first();
		if (
			compensation ||
			(operation.release_id && active?.active_release_id === operation.release_id)
		) {
			await compensateManagedPluginActivation(context, operation);
			response = jsonResponse({ error: { code: "PLUGIN_ACTIVATION_COMPENSATED" } }, 500);
		} else {
			const restored = await restoreManagedPluginOperation(env.DB, operation);
			for (const plugin of restored)
				await context.locals.emdash.setPluginStatus(plugin.plugin_id, plugin.status);
			response = jsonResponse({ error: { code: "PLUGIN_OPERATION_INTERRUPTED" } }, 503);
		}
		await completeManagedPluginOperation(env.DB, operation, response);
		await wakePendingPluginWorkflows();
		return true;
	} catch (error) {
		console.error("[managed-plugin-lifecycle] recovery remains pending", error);
		await markManagedPluginRecoveryRequired(env.DB, operation);
		return false;
	}
}

async function markManagedPluginRecoveryRequired(
	db: D1Database,
	operation: ManagedPluginOperation,
) {
	await db
		.prepare(
			"UPDATE superboard_managed_plugin_operations SET recovery_error = 'PLUGIN_RECOVERY_REQUIRED' WHERE operation_id = ? AND owner_token = ? AND status = 'running'",
		)
		.bind(operation.operation_id, operation.owner_token)
		.run();
}
