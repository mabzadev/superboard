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
import {
	migratePluginPackages,
	packageActionComponents,
	setPluginFeaturePreference,
	syncPluginPackageRuntime,
} from "./plugin-package-state.js";
import { wakePendingPluginWorkflows } from "./plugin-task-wakeup.js";
import { getSiteEnv } from "./site-env.js";
import {
	loadActiveSuperBoardPluginIdsRequiringValidation,
	resolveSuperBoardPluginTarget,
	resolveSuperBoardTargetPluginIds,
	stageSuperBoardPluginDependencyHealth,
	transitionSuperBoardPluginLifecycle,
} from "./superboard-plugin-catalog.js";

const operationIdPattern = /^[A-Za-z0-9._:-]{8,200}$/u;
const packageInputErrors = new Set([
	"PLUGIN_NOT_FOUND",
	"PLUGIN_FEATURE_NOT_FOUND",
	"CORE_COMPONENT_REQUIRED",
	"PLUGIN_FEATURE_NOT_IN_TARGET",
	"PLUGIN_NO_ENABLED_FEATURES",
	"PLUGIN_OPERATION_IN_PROGRESS",
]);

type ManagedPluginLifecycleAction = "enable" | "disable";

export async function runManagedPluginLifecycleAction(
	context: APIContext,
	action: ManagedPluginLifecycleAction,
): Promise<Response> {
	const env = getSiteEnv();
	const denied = requireReleaseOperator(context, env);
	if (denied) return denied;
	const target = resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT);
	const scope = { instance_id: env.SUPERBOARD_INSTANCE_ID, target };
	const targetComponents = resolveSuperBoardTargetPluginIds(env.SUPERBOARD_PLUGIN_IDS);
	if (!(await recoverExpiredManagedPluginOperation(context)))
		return jsonResponse({ error: { code: "PLUGIN_RECOVERY_REQUIRED" } }, 503);
	let selection: Awaited<ReturnType<typeof packageActionComponents>>;
	try {
		await migratePluginPackages(env.DB, scope, targetComponents);
		selection = await packageActionComponents(env.DB, scope, {
			packageId: context.params.pluginId ?? "",
			action,
			targetComponents,
			featureId: context.params.featureId,
		});
	} catch (error) {
		const code =
			error instanceof Error && packageInputErrors.has(error.message)
				? error.message
				: "PLUGIN_PACKAGE_CONFIGURATION_UNAVAILABLE";
		return jsonResponse({ error: { code } }, code === "PLUGIN_NOT_FOUND" ? 404 : 409);
	}
	const pluginId = selection.owner.id;
	const componentIds = selection.components;
	const selected = new Set(componentIds);
	const operationId = context.request.headers.get("Idempotency-Key") ?? crypto.randomUUID();
	if (!operationIdPattern.test(operationId))
		return jsonResponse({ error: { code: "INVALID_IDEMPOTENCY_KEY" } }, 422);
	const started = await beginManagedPluginOperation(env.DB, {
		operation_id: operationId,
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		target,
		plugin_id: context.params.featureId ?? pluginId,
		action,
	});
	if ("response" in started) return started.response;
	const { operation } = started;
	const releaseId = localId();
	let response: Response;
	try {
		const currentRows = await env.DB.prepare(
			"SELECT plugin_id,state FROM superboard_plugin_lifecycle WHERE instance_id=? AND target=?",
		)
			.bind(operation.instance_id, target)
			.all<{ plugin_id: string; state: string }>();
		const current = new Map(currentRows.results.map((row) => [row.plugin_id, row.state]));
		const stale = await loadActiveSuperBoardPluginIdsRequiringValidation(env.DB, {
			...operation,
			checked_at: new Date().toISOString(),
			target_artifact_checksum: env.TARGET_ARTIFACT_CHECKSUM,
		});
		if (
			(action === "enable" &&
				componentIds.every((id) => current.get(id) === "active" && !stale.includes(id))) ||
			(action === "disable" &&
				componentIds.every(
					(id) =>
						!current.has(id) ||
						["available", "installed", "disabled"].includes(current.get(id) ?? ""),
				))
		) {
			const active = await env.DB.prepare(
				"SELECT active_release_id FROM superboard_front_active_releases WHERE instance_id = ?",
			)
				.bind(operation.instance_id)
				.first<{ active_release_id: string }>();
			await syncPluginPackageRuntime(env.DB, scope, context.locals.emdash);
			response = jsonResponse(
				{
					plugin_id: pluginId,
					status: action === "enable" ? "active" : "disabled",
					release_id: active?.active_release_id ?? null,
				},
				200,
			);
		} else {
			const changingComponents =
				action === "disable"
					? componentIds.filter((id) => current.get(id) === "active")
					: componentIds;
			if (!changingComponents.length) {
				response = jsonResponse({ error: { code: "PLUGIN_LIFECYCLE_STATE_CONFLICT" } }, 409);
			} else {
				await snapshotManagedPluginOperation(env.DB, operation, releaseId);
				response = await executeManagedPluginLifecycleAction(
					{ ...context, params: { ...context.params, pluginId } },
					action,
					operation,
					releaseId,
					changingComponents,
				);
				if (!response.ok) {
					await restoreManagedPluginOperation(env.DB, operation);
					await syncPluginPackageRuntime(env.DB, scope, context.locals.emdash);
				}
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
			await restoreManagedPluginOperation(env.DB, operation);
			await syncPluginPackageRuntime(env.DB, scope, context.locals.emdash);
			response = jsonResponse({ error: { code: "PLUGIN_LIFECYCLE_ACTION_FAILED" } }, 500);
		}
	}
	if (response.ok && context.params.featureId && selected.has(context.params.featureId))
		await setPluginFeaturePreference(env.DB, scope, context.params.featureId, action === "enable");
	if (response.ok) {
		const body: unknown = await response.json();
		if (body && typeof body === "object" && !Array.isArray(body))
			response = jsonResponse(
				{
					...body,
					plugin_id: context.params.pluginId ?? pluginId,
					package_id: pluginId,
					...(context.params.featureId ? { feature_id: context.params.featureId } : {}),
				},
				response.status,
			);
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
	componentIds: readonly string[],
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
			...stalePluginIds.filter((id) => action !== "disable" || !componentIds.includes(id)),
			...(action === "enable" ? componentIds : []),
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
		...(action === "enable" ? { plugin_ids: componentIds } : { excluded_plugin_ids: componentIds }),
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
		for (const componentId of componentIds) {
			const state = await env.DB.prepare(
				"SELECT state FROM superboard_plugin_lifecycle WHERE instance_id=? AND target=? AND plugin_id=?",
			)
				.bind(env.SUPERBOARD_INSTANCE_ID, target, componentId)
				.first<{ state: string }>();
			if (state?.state !== "active") continue;
			await transitionSuperBoardPluginLifecycle(env.DB, {
				instance_id: env.SUPERBOARD_INSTANCE_ID,
				target,
				plugin_id: componentId,
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
					componentId,
					componentId,
					new Date().toISOString(),
					env.SUPERBOARD_INSTANCE_ID,
					target,
					componentId,
				)
				.first<{ busy: number }>();
			if (busy?.busy)
				return jsonResponse({ error: { code: "PLUGIN_OPERATIONS_IN_PROGRESS" } }, 409);
		}
	}

	await renewManagedPluginOperation(env.DB, operation);
	const activated = await invoke(activateRelease, workflowContext, "releases/activate", {
		candidate_id: identifiers.candidate_id,
		activation_id: `plugin:${operation.operation_id}`,
		expected_active_release_id: slice.previous_release_id,
	});
	if (!activated.ok) return activated;
	await syncPluginPackageRuntime(
		env.DB,
		{ instance_id: env.SUPERBOARD_INSTANCE_ID, target },
		context.locals.emdash,
	);
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

export async function recoverExpiredManagedPluginOperation(context: APIContext) {
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
			await restoreManagedPluginOperation(env.DB, operation);
			await syncPluginPackageRuntime(
				env.DB,
				{ instance_id: operation.instance_id, target: operation.target },
				context.locals.emdash,
			);
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
