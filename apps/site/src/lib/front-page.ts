import { hasPermission, type RoleLevel } from "@emdash-cms/auth";
import {
	assertRendererCompatibility,
	resolveFrontRequest,
	type CompiledFrontRelease,
	type FrontRequestResolution,
} from "@superboard/supbrd-core";
import type { UserMember } from "@superboard/supbrd-plug-user";

import {
	loadDependencyHealth,
	loadLastVerifiedFrontRelease,
	type LoadedFrontRelease,
} from "./release-source.js";
import type { SuperBoardSiteEnv } from "./site-env.js";
import { CORE_ADMIN_SHELL_DESCRIPTOR } from "./user-front-release.js";

interface EmDashUser {
	id: string;
	email: string;
	name: string | null;
	role: RoleLevel;
	disabled: boolean;
}

export interface FrontPageModel {
	instance_id: string;
	release: LoadedFrontRelease | null;
	resolution: FrontRequestResolution;
	page_title: string | null;
	operator: UserMember | null;
	members: UserMember[];
}

export async function resolveSiteFrontPage(
	env: SuperBoardSiteEnv,
	requestedPath: string,
	user: EmDashUser | undefined,
): Promise<FrontPageModel> {
	const instanceId = env.SUPERBOARD_INSTANCE_ID;
	const release = await loadLastVerifiedFrontRelease(env, instanceId);
	return resolveFrontPageFromRelease(env, release, requestedPath, user);
}

export async function resolvePreviewFrontPage(
	env: SuperBoardSiteEnv,
	release: CompiledFrontRelease,
	requestedPath: string,
	user: EmDashUser | undefined,
): Promise<FrontPageModel> {
	const loaded: LoadedFrontRelease = {
		release,
		runtime_release: {
			front_route_manifest: release.payload.front_route_manifest,
			dependency_policies: release.payload.dependency_policies,
		},
		pointer_revision: 0,
		source: "preview",
	};
	return resolveFrontPageFromRelease(env, loaded, requestedPath, user);
}

async function resolveFrontPageFromRelease(
	env: SuperBoardSiteEnv,
	release: LoadedFrontRelease | null,
	requestedPath: string,
	user: EmDashUser | undefined,
): Promise<FrontPageModel> {
	let dependencyHealth: Record<string, "ready" | "unavailable"> = {};
	if (release) {
		try {
			dependencyHealth = await loadDependencyHealth(
				env.DB,
				env.SUPERBOARD_INSTANCE_ID,
				new Date().toISOString(),
			);
		} catch {
			dependencyHealth = {};
		}
	}
	let resolution = resolveFrontRequest({
		last_verified_release: release?.runtime_release ?? null,
		requested_path: requestedPath,
		admin_session: user ? "valid" : "absent",
		permissions: hasPermission(user, "settings:manage")
			? ["superboard.admin.access", "users.read", "users.write"]
			: [],
		dependency_health: dependencyHealth,
	});
	if (resolution.result === "rendered" && resolution.layout_ids.length > 0 && release) {
		try {
			for (const layoutId of resolution.layout_ids) {
				const layout = release.release.payload.presentation.layouts.find(
					(entry) => entry.layout_id === layoutId,
				);
				if (layout?.root_renderer_id !== CORE_ADMIN_SHELL_DESCRIPTOR.renderer_id) {
					throw new Error(`Unknown root layout renderer for ${layoutId}`);
				}
				assertRendererCompatibility(CORE_ADMIN_SHELL_DESCRIPTOR, {
					abi_version: "1.0.0",
					runtime_version: "0.1.0",
				});
			}
		} catch {
			resolution = {
				result: "unavailable",
				route_id: resolution.route_id,
				state_renderer_id: "emdash.core.state.unavailable",
			};
		}
	}
	const pageTitle =
		resolution.result === "rendered" && release
			? (release.release.payload.presentation.pages.find(
					(page) => page.page_id === resolution.page_id,
				)?.title ?? null)
			: null;
	const operator = user
		? { id: user.id, email: user.email, name: user.name, role: user.role, disabled: user.disabled }
		: null;
	let members: UserMember[] = [];
	if (
		resolution.result === "rendered" &&
		resolution.renderer_ids.includes("supbrd-plug-user.renderer.members_table")
	) {
		try {
			const rows = await env.DB.prepare(
				"SELECT id, email, name, role, disabled FROM users ORDER BY email LIMIT 100",
			).all<UserMember>();
			members = rows.results.map((row) => ({ ...row, disabled: Boolean(row.disabled) }));
		} catch {
			members = [];
		}
	}
	return {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		release,
		resolution,
		page_title: pageTitle,
		operator,
		members,
	};
}
