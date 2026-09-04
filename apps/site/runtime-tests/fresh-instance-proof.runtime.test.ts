import { Role } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { createDialect } from "@emdash-cms/cloudflare/db/d1";
import {
	activateFrontRelease,
	approveFrontReleaseCandidate,
	compileFrontRelease,
	createFrontPreview,
	createOperatorReauthenticationReceipt,
	resolveFrontRequest,
	type CompiledFrontRelease,
} from "@superboard/supbrd-core";
import { env } from "cloudflare:workers";
import { runMigrations } from "emdash/db";
import { Kysely } from "kysely";
import { afterAll, expect, test } from "vitest";

import {
	candidateEvidence,
	getFrontReleaseCandidate,
	persistFrontPreview,
	persistReauthenticationReceipt,
} from "../src/lib/front-workflow-repository.js";
import {
	createD1FrontReleaseRepository,
	persistReleaseApproval,
	stageCompiledFrontRelease,
	verifyActivationReceipts,
} from "../src/lib/release-repository.js";
import { loadLastVerifiedFrontRelease } from "../src/lib/release-source.js";
import type { FrontPageModel } from "../src/lib/front-page.js";
import { mountNativeFrontRenderer } from "../src/lib/native-front-plugins.js";
import { projectNativeFrontPresentation } from "../src/lib/native-front-presentation.js";
import {
	finalizeSuperBoardPluginLifecycleForRelease,
	installSuperBoardPluginCatalog,
	loadActiveSuperBoardPluginLock,
	loadReleasableSuperBoardPluginLock,
	prepareSuperBoardPluginLifecycleForRelease,
	superBoardRuntimePluginCatalog,
	type SuperBoardPluginTarget,
} from "../src/lib/superboard-plugin-catalog.js";
import { composeUserFrontReleaseInput } from "../src/lib/user-front-release.js";

const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/u;

interface FreshInstancePlan {
	adapters: Array<{
		environment: "local" | "development";
		adapter: "local" | "cloudflare";
		artifact_checksum: string;
		graph_checksum: string;
	}>;
	plugins: {
		catalog_count: number;
		installed_count: number;
		target_count: number;
		target_inactive_count: number;
		catalog_ids: string[];
		installed_ids: string[];
		target_ids: string[];
	};
}

interface RuntimeEvidence {
	environment: "local" | "development";
	adapter: "local" | "cloudflare";
	artifact_checksum: string;
	graph_checksum: string;
	operator: { email: string; role: "admin" };
	plugins: {
		manifest_count: number;
		installed_count: number;
		target_active_count: number;
		target_inactive_count: number;
		installation_step_receipt_count: number;
	};
	stores: { declared_count: number };
	workers: { plugin_health_receipt_count: number };
	release: {
		status: "active";
		validation_receipt_count: number;
		active_route_count: number;
		catalog_declared_route_count: number;
		catalog_rendered_route_count: number;
		catalog_mounted_renderer_count: number;
	};
}

const runtimeEvidence: RuntimeEvidence[] = [];
const compiledPlan = freshInstancePlan();

test("the isolated runtime receives both compiled target artifacts", () => {
	const plan = freshInstancePlan();

	expect(plan.adapters.map(({ environment, adapter }) => ({ environment, adapter }))).toEqual([
		{ environment: "local", adapter: "local" },
		{ environment: "development", adapter: "cloudflare" },
	]);
	expect(plan.adapters.every(({ artifact_checksum }) => CHECKSUM_PATTERN.test(artifact_checksum))).toBe(
		true,
	);
	expect(plan.adapters[0]?.graph_checksum).toBe(plan.adapters[1]?.graph_checksum);
	expect(plan.plugins.catalog_ids).toContain("supbrd-plug-user");
	expect(plan.plugins.installed_ids).toEqual(plan.plugins.catalog_ids);
	expect(plan.plugins.target_ids.every((pluginId) => plan.plugins.catalog_ids.includes(pluginId))).toBe(
		true,
	);
});

test.each(compiledPlan.adapters)(
	"builds a complete blank Instance through the $environment/$adapter target artifact",
	async (targetArtifact) => {
		const target = targetArtifact.environment satisfies SuperBoardPluginTarget;
		const operatorDb = new Kysely({
			dialect: createDialect({ binding: "DB", session: "disabled" }),
		});
		await runMigrations(operatorDb);
		const operatorAdapter = createKyselyAdapter(operatorDb);
		const previousOperator = await operatorAdapter.getUserByEmail("mabzadev@gmail.com");
		if (previousOperator) await operatorAdapter.deleteUser(previousOperator.id);
		expect(await operatorAdapter.getUserByEmail("mabzadev@gmail.com")).toBeNull();
		const operator = await operatorAdapter.createUser({
			email: "mabzadev@gmail.com",
			name: "SuperBoard Operator",
			role: Role.ADMIN,
			emailVerified: true,
		});
		expect(await operatorAdapter.getUserByEmail(operator.email)).toMatchObject({
			id: operator.id,
			email: operator.email,
			role: Role.ADMIN,
		});
		const catalog = superBoardRuntimePluginCatalog();
		const targetArtifactChecksum = targetArtifact.artifact_checksum;
		const now = new Date();
		const checkedAt = now.toISOString();
		const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString();
		const reauthenticationExpiresAt = new Date(now.getTime() + 5 * 60 * 1_000).toISOString();
		const instanceId = `blank-${target}`;
		const operatorId = operator.id;
		const plan = await installSuperBoardPluginCatalog(env.DB, {
			instance_id: instanceId,
			target,
			plan_id: `plugin-plan-${target}`,
			approved_by: operatorId,
			target_artifact_checksum: targetArtifactChecksum,
			target_plugin_ids: compiledPlan.plugins.installed_ids,
			plugin_ids: compiledPlan.plugins.installed_ids,
			checked_at: checkedAt,
			expires_at: expiresAt,
		});

		expect(catalog.plugins.map(({ manifest }) => manifest.plugin_id)).toEqual(
			compiledPlan.plugins.catalog_ids,
		);
		expect(plan).toMatchObject({
			status: "installed",
			plugin_count: compiledPlan.plugins.catalog_count,
			target_artifact_checksum: targetArtifactChecksum,
		});
		expect(plan.plugins).toHaveLength(compiledPlan.plugins.catalog_count);
		expect(
			plan.plugins.every(
				({ derived, health_evidence_checksum: healthEvidenceChecksum }) =>
					derived.worker_status === "ready" && CHECKSUM_PATTERN.test(healthEvidenceChecksum),
			),
		).toBe(true);
		expect(
			plan.plugins.flatMap(({ derived }) => Object.values(derived.step_receipts)),
		).toHaveLength(plan.plugins.length * 8);
		const convergedStores = plan.plugins.flatMap(({ derived }) => derived.stores);
		expect(convergedStores.length).toBeGreaterThan(0);

		const releasablePluginLock = await loadReleasableSuperBoardPluginLock(env.DB, {
			instance_id: instanceId,
			target,
		});
		const targetPluginIds = new Set(compiledPlan.plugins.target_ids);
		const pluginLock = releasablePluginLock.filter(({ plugin_id: pluginId }) =>
			targetPluginIds.has(pluginId),
		);
		expect(pluginLock.map(({ plugin_id: pluginId }) => pluginId).toSorted()).toEqual(
			compiledPlan.plugins.target_ids,
		);
		const suffix = target === "local" ? "1" : "2";
		const release = await compileFrontRelease(
			await composeUserFrontReleaseInput({
				instance_id: instanceId,
				front_draft_id: `01J0000000000000000000060${suffix}`,
				draft_snapshot_id: `01J0000000000000000000061${suffix}`,
				compilation_id: `01J0000000000000000000062${suffix}`,
				candidate_id: `01J0000000000000000000063${suffix}`,
				release_id: `01J0000000000000000000064${suffix}`,
				release_sequence: 1,
				previous_release_id: null,
				plugin_lock: pluginLock,
				created_at: checkedAt,
			}),
			await signingInput(`fresh-instance-${target}`),
		);
		const publicJwk = await publicSigningJwk(lastSigningKeys!, `fresh-instance-${target}`);
		await stageCompiledFrontRelease(env.DB, release, publicJwk, checkedAt);
		const candidate = await getFrontReleaseCandidate(env.DB, release.payload.candidate_id);
		if (!candidate) throw new Error("Fresh Instance candidate was not persisted");
		const preview = createFrontPreview(candidate, {
			preview_id: `fresh-preview-${target}`,
			issued_at: checkedAt,
			expires_at: expiresAt,
		});
		await persistFrontPreview(env.DB, preview);
		const approvalReauthentication = await createOperatorReauthenticationReceipt({
			receipt_id: `fresh-approval-reauth-${target}`,
			operator_id: operatorId,
			instance_id: instanceId,
			action: "front_release.approve",
			candidate_id: release.payload.candidate_id,
			reauthenticated_at: checkedAt,
			expires_at: reauthenticationExpiresAt,
		});
		const approval = await approveFrontReleaseCandidate(candidate, {
			reauthentication: approvalReauthentication,
			approved_at: checkedAt,
			warnings_acknowledged: release.validation_receipts
				.filter(({ level }) => level === "warning")
				.map(({ receipt_id: receiptId }) => receiptId),
		});
		expect(approval.status).toBe("approved");
		if (approval.status !== "approved") throw new Error("Fresh Instance approval failed");
		await persistReauthenticationReceipt(env.DB, approvalReauthentication, checkedAt);
		expect(
			await persistReleaseApproval(env.DB, approval.approval, approvalReauthentication.receipt_id),
		).toBe(true);
		await prepareSuperBoardPluginLifecycleForRelease(env.DB, {
			instance_id: instanceId,
			target,
			release_id: release.payload.release_id,
			plugin_lock: release.payload.plugin_lock,
			prepared_at: checkedAt,
		});
		const activationReauthentication = await createOperatorReauthenticationReceipt({
			receipt_id: `fresh-activation-reauth-${target}`,
			operator_id: operatorId,
			instance_id: instanceId,
			action: "front_release.activate",
			candidate_id: release.payload.candidate_id,
			reauthenticated_at: checkedAt,
			expires_at: reauthenticationExpiresAt,
		});
		const activation = await activateFrontRelease(createD1FrontReleaseRepository(env.DB), {
			instance_id: instanceId,
			candidate_id: release.payload.candidate_id,
			activation_id: `fresh-activation-${target}`,
			expected_active_release_id: null,
			approval: approval.approval,
			reauthentication: activationReauthentication,
			activated_at: checkedAt,
		});
		expect(activation.status).toBe("activated");
		if (activation.status !== "activated") throw new Error("Fresh Instance activation failed");
		expect(
			await verifyActivationReceipts(env.DB, {
				activation_id: activation.activation_id,
				instance_id: instanceId,
				active_release_id: activation.active_release_id,
				pointer_revision: activation.pointer_revision,
			}),
		).toBe(true);
		await finalizeSuperBoardPluginLifecycleForRelease(env.DB, {
			instance_id: instanceId,
			target,
			release_id: release.payload.release_id,
			finalized_at: checkedAt,
		});
		const active = await loadLastVerifiedFrontRelease(
			{ ...env, SUPERBOARD_INSTANCE_ID: instanceId },
			instanceId,
		);
		expect(active?.release.payload.release_id).toBe(release.payload.release_id);
		expect(release.validation_receipts.every(({ status }) => status === "passed")).toBe(true);
		const frontOperator: NonNullable<FrontPageModel["operator"]> = {
			id: operator.id,
			email: operator.email,
			name: operator.name,
			role: operator.role,
			disabled: false,
		};
		const activeRouteEvidence = renderReleaseRoutes(
			release,
			active!,
			instanceId,
			frontOperator,
		);
		const catalogRelease = await compileFrontRelease(
			await composeUserFrontReleaseInput({
				instance_id: instanceId,
				front_draft_id: `01J0000000000000000000070${suffix}`,
				draft_snapshot_id: `01J0000000000000000000071${suffix}`,
				compilation_id: `01J0000000000000000000072${suffix}`,
				candidate_id: `01J0000000000000000000073${suffix}`,
				release_id: `01J0000000000000000000074${suffix}`,
				release_sequence: 2,
				previous_release_id: release.payload.release_id,
				plugin_lock: releasablePluginLock,
				created_at: checkedAt,
			}),
			await signingInput(`fresh-instance-catalog-${target}`),
		);
		const catalogRouteEvidence = renderReleaseRoutes(
			catalogRelease,
			{
				release: catalogRelease,
				runtime_release: {
					front_route_manifest: catalogRelease.payload.front_route_manifest,
					dependency_policies: catalogRelease.payload.dependency_policies,
				},
				pointer_revision: 0,
				source: "preview",
			},
			instanceId,
			frontOperator,
		);
		expect(catalogRouteEvidence.declared_route_count).toBeGreaterThanOrEqual(
			activeRouteEvidence.declared_route_count,
		);
		expect(await candidateEvidence(env.DB, candidate)).toMatchObject({
			dependencies_ready: true,
			stores_ready: true,
			migrations_ready: true,
			workers_ready: true,
		});
		const activePluginLock = await loadActiveSuperBoardPluginLock(env.DB, {
			instance_id: instanceId,
			target,
		});
		expect(activePluginLock.map(({ plugin_id: pluginId }) => pluginId).toSorted()).toEqual(
			compiledPlan.plugins.target_ids,
		);
		runtimeEvidence.push({
			environment: target,
			adapter: targetArtifact.adapter,
			artifact_checksum: targetArtifactChecksum,
			graph_checksum: targetArtifact.graph_checksum,
			operator: { email: operator.email, role: "admin" },
			plugins: {
				manifest_count: catalog.plugins.length,
				installed_count: plan.plugins.length,
				target_active_count: activePluginLock.length,
				target_inactive_count: catalog.plugins.length - activePluginLock.length,
				installation_step_receipt_count: plan.plugins.flatMap(({ derived }) =>
					Object.values(derived.step_receipts),
				).length,
			},
			stores: { declared_count: convergedStores.length },
			workers: { plugin_health_receipt_count: plan.plugins.length },
			release: {
				status: "active",
				validation_receipt_count: release.validation_receipts.length,
				active_route_count: activeRouteEvidence.declared_route_count,
				catalog_declared_route_count: catalogRouteEvidence.declared_route_count,
				catalog_rendered_route_count: catalogRouteEvidence.rendered_route_count,
				catalog_mounted_renderer_count: catalogRouteEvidence.mounted_renderer_count,
			},
		});
	},
);

afterAll(() => {
	console.info(`SUPERBOARD_FRESH_INSTANCE_RUNTIME=${JSON.stringify(runtimeEvidence)}`);
});

let lastSigningKeys: CryptoKeyPair | undefined;

async function signingInput(kid: string) {
	lastSigningKeys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	return { kid, private_key: lastSigningKeys.privateKey };
}

async function publicSigningJwk(keys: CryptoKeyPair, kid: string) {
	return { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid };
}

function concretePath(path: string) {
	return path.replaceAll(/:([A-Za-z][A-Za-z0-9_]*)/gu, "proof").replaceAll(/\*/gu, "proof/path");
}

function renderReleaseRoutes(
	release: CompiledFrontRelease,
	loaded: NonNullable<FrontPageModel["release"]>,
	instanceId: string,
	operator: NonNullable<FrontPageModel["operator"]>,
) {
	const permissions = release.payload.front_route_manifest.routes
		.map(({ permission_expression: permission }) => permission)
		.filter((permission) => permission !== "allow");
	const dependencyHealth = Object.fromEntries(
		release.payload.dependency_policies.map(({ dependency_id: dependencyId }) => [
			dependencyId,
			"ready" as const,
		]),
	);
	let renderedRouteCount = 0;
	let mountedRendererCount = 0;
	for (const route of release.payload.front_route_manifest.routes) {
		const path = concretePath(route.path_pattern);
		const resolution = resolveFrontRequest({
			last_verified_release: loaded.runtime_release,
			requested_path: path,
			admin_session: route.auth_policy === "anonymous_only" ? "absent" : "valid",
			permissions,
			dependency_health: dependencyHealth,
		});
		expect(resolution.result, route.route_id).toBe("rendered");
		if (resolution.result !== "rendered") continue;
		renderedRouteCount += 1;
		const model: FrontPageModel = {
			instance_id: instanceId,
			requested_path: path,
			release: loaded,
			resolution,
			page_title:
				release.payload.presentation.pages.find(
					({ page_id: pageId }) => pageId === resolution.page_id,
				)?.title ?? null,
			operator: route.auth_policy === "anonymous_only" ? null : operator,
			permissions,
		};
		const projection = projectNativeFrontPresentation(model);
		const mounts = [...projection.layout_mounts, ...projection.content_mounts];
		const documents = mounts.map((mount) =>
			mountNativeFrontRenderer({ mount, plugin_lock: projection.plugin_lock }),
		);
		expect(documents.length, `${route.route_id} mounted no renderer`).toBeGreaterThan(0);
		mountedRendererCount += documents.length;
	}
	expect(renderedRouteCount).toBe(release.payload.front_route_manifest.routes.length);
	expect(mountedRendererCount).toBeGreaterThanOrEqual(renderedRouteCount);
	return {
		declared_route_count: release.payload.front_route_manifest.routes.length,
		rendered_route_count: renderedRouteCount,
		mounted_renderer_count: mountedRendererCount,
	};
}

function freshInstancePlan(): FreshInstancePlan {
	const value = (env as typeof env & { FRESH_INSTANCE_PLAN_JSON?: string })
		.FRESH_INSTANCE_PLAN_JSON;
	if (!value) throw new Error("Fresh Instance target plan is unavailable");
	return JSON.parse(value) as FreshInstancePlan;
}
