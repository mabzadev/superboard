import {
	resolveFrontRequest,
	type CompiledFrontRelease,
	type FrontRequestResolution,
} from "@superboard/supbrd-core";
import { hasPermission, type RoleLevel } from "@emdash-cms/auth";

import { loadDependencyHealth, loadLastVerifiedFrontRelease, type LoadedFrontRelease } from "./release-source.js";
import type { SuperBoardSiteEnv } from "./site-env.js";

interface EmDashUser {
	role: RoleLevel;
}

export interface FrontPageModel {
	instance_id: string;
	release: LoadedFrontRelease | null;
	resolution: FrontRequestResolution;
	page_title: string | null;
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
	const resolution = resolveFrontRequest({
		last_verified_release: release?.runtime_release ?? null,
		requested_path: requestedPath,
		admin_session: user ? "valid" : "absent",
		permissions: hasPermission(user, "settings:manage") ? ["superboard.admin.access"] : [],
		dependency_health: dependencyHealth,
	});
	const pageTitle =
		resolution.result === "rendered" && release
			? release.release.payload.presentation.pages.find((page) => page.page_id === resolution.page_id)
					?.title ?? null
			: null;
	return {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		release,
		resolution,
		page_title: pageTitle,
	};
}
