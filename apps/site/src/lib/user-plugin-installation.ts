import { userPluginManifest } from "@superboard/supbrd-plug-user";

import {
	installSuperBoardPluginCatalog,
	type SuperBoardPluginTarget,
} from "./superboard-plugin-catalog.js";

const USER_DEPENDENCY_ID = "dependency.supbrd_plug_user";

export async function installCompiledUserPlugin(
	db: D1Database,
	input: {
		instance_id: string;
		target?: SuperBoardPluginTarget;
		approved_by: string;
		checked_at: string;
		expires_at: string;
	},
) {
	const target = input.target ?? "local";
	const plan = await installSuperBoardPluginCatalog(db, {
		...input,
		target,
		plan_id: `user-plugin-plan-${crypto.randomUUID()}`,
		plugin_ids: [userPluginManifest.plugin_id],
	});
	const plugin = plan.plugins[0];
	if (!plugin) throw new Error("USER_PLUGIN_INSTALLATION_PLAN_EMPTY");
	return {
		instance_id: input.instance_id,
		target,
		dependency_id: USER_DEPENDENCY_ID,
		plugin_id: userPluginManifest.plugin_id,
		plugin_version: userPluginManifest.plugin_version,
		artifact_checksum: userPluginManifest.artifact_checksum,
		activation_scope: "front_release" as const,
		status: "installed" as const,
		checked_at: input.checked_at,
		expires_at: input.expires_at,
		evidence_checksum: plugin.health_evidence_checksum,
		plan_id: plan.plan_id,
	};
}
