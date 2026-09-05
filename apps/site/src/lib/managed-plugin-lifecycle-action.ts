import type { APIContext, APIRoute } from "astro";

import { POST as synchronizePlugins } from "../pages/_superboard/api/plugins/sync.js";
import { POST as activateRelease } from "../pages/_superboard/api/releases/activate.js";
import { POST as approveRelease } from "../pages/_superboard/api/releases/approve.js";
import { POST as compileRelease } from "../pages/_superboard/api/releases/compile.js";
import { POST as createUserSlice } from "../pages/_superboard/api/releases/user-slice.js";
import {
	jsonResponse,
	recentOperatorReauthentication,
	requireReleaseOperator,
	withLocalOperatorReauthentication,
} from "./operator-guard.js";
import { getSiteEnv } from "./site-env.js";
import {
	loadActiveSuperBoardPluginIdsRequiringValidation,
	resolveSuperBoardPluginTarget,
	stageSuperBoardPluginDependencyHealth,
	transitionSuperBoardPluginLifecycle,
} from "./superboard-plugin-catalog.js";

type ManagedPluginLifecycleAction = "enable" | "disable";

export async function runManagedPluginLifecycleAction(
	context: APIContext,
	action: ManagedPluginLifecycleAction,
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
	let workflowContext = context;
	let reauthentication = await recentOperatorReauthentication(
		workflowContext,
		reauthenticationInput,
	);
	if (!reauthentication && env.SUPERBOARD_ENVIRONMENT === "local" && context.locals.user) {
		workflowContext = withLocalOperatorReauthentication(context, env, reauthenticationInput.now);
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
		release_id: localId(),
	};
	const checkedAt = new Date().toISOString();
	const stalePluginIds = await loadActiveSuperBoardPluginIdsRequiringValidation(env.DB, {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		target,
		checked_at: checkedAt,
		target_artifact_checksum: env.TARGET_ARTIFACT_CHECKSUM,
	});
	const pluginIds = [...new Set([...stalePluginIds, ...(action === "enable" ? [pluginId] : [])])];
	if (pluginIds.length > 0) {
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
		await workflowContext.locals.emdash.setPluginStatus(pluginId, "inactive");
	}

	const activated = await invoke(activateRelease, workflowContext, "releases/activate", {
		candidate_id: identifiers.candidate_id,
		activation_id: `plugin-${action}-${crypto.randomUUID()}`,
		expected_active_release_id: slice.previous_release_id,
	});
	if (!activated.ok) {
		if (action === "disable") {
			await transitionSuperBoardPluginLifecycle(env.DB, {
				instance_id: env.SUPERBOARD_INSTANCE_ID,
				target,
				plugin_id: pluginId,
				to_state: "active",
				changed_at: new Date().toISOString(),
				reason: "Front Release activation failed",
			});
			await workflowContext.locals.emdash.setPluginStatus(pluginId, "active");
		}
		return activated;
	}
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
