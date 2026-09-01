import {
	compileFrontRelease,
	createFrontPreview,
	createOperatorReauthenticationReceipt,
	planPointerRollback,
	type CompiledFrontRelease,
	type FrontReleaseInput,
	type ReleaseApproval,
} from "@superboard/supbrd-core";
import { userPluginManifest } from "@superboard/supbrd-plug-user";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import { resolvePreviewFrontPage, resolveSiteFrontPage } from "../src/lib/front-page.js";
import {
	createDraftSnapshotCas,
	getCandidateByReleaseId,
	loadDraftSnapshot,
	loadFrontPreview,
	persistFrontPreview,
	saveFrontDraft,
} from "../src/lib/front-workflow-repository.js";
import {
	createD1FrontReleaseRepository,
	persistReleaseApproval,
	stageCompiledFrontRelease,
	verifyActivationReceipts,
} from "../src/lib/release-repository.js";
import { loadLastVerifiedFrontRelease } from "../src/lib/release-source.js";
import { composeUserFrontReleaseInput } from "../src/lib/user-front-release.js";

function release(): CompiledFrontRelease {
	return {
		payload: {
			instance_id: "vocostar",
			candidate_id: "candidate-runtime",
			release_id: "release-runtime",
			previous_release_id: null,
		} as CompiledFrontRelease["payload"],
		content_checksum: `sha256:${"1".repeat(64)}`,
		signature: { algorithm: "ES256", kid: "runtime-key", value: "signature" },
		validation_receipts: [],
		validation_set_checksum: `sha256:${"2".repeat(64)}`,
		verification_status: "verified",
	};
}

describe("Site Front Release D1 workflow", () => {
	test("serves maintenance before the Instance has an active release", async () => {
		expect((await resolveSiteFrontPage(env, "/login", undefined)).resolution).toEqual({
			result: "maintenance",
			route_id: null,
			state_renderer_id: null,
		});
	});

	test("persists one immutable snapshot behind draft revision CAS", async () => {
		const created = await saveFrontDraft(env.DB, {
			front_draft_id: "draft-runtime",
			instance_id: "vocostar",
			expected_draft_revision: 0,
			value: { title: "First" },
			updated_at: "2026-08-30T00:00:00.000Z",
		});
		expect(created.status).toBe("updated");
		const conflict = await saveFrontDraft(env.DB, {
			front_draft_id: "draft-runtime",
			instance_id: "vocostar",
			expected_draft_revision: 0,
			value: { title: "Stale" },
			updated_at: "2026-08-30T00:01:00.000Z",
		});
		expect(conflict).toEqual({ status: "conflict", current_revision: 1 });
		expect(
			await createDraftSnapshotCas(env.DB, {
				draft_snapshot_id: "snapshot-runtime",
				front_draft_id: "draft-runtime",
				instance_id: "vocostar",
				expected_draft_revision: 1,
				created_at: "2026-08-30T00:02:00.000Z",
			}),
		).toMatchObject({ status: "created", snapshot: { draft_revision: 1 } });
		expect(await loadDraftSnapshot(env.DB, "snapshot-runtime")).toMatchObject({
			draft_revision: 1,
			input: { title: "First" },
		});
	});

	test("activates atomically and rejects a stale active pointer", async () => {
		const candidate = release();
		await stageCompiledFrontRelease(
			env.DB,
			candidate,
			{ kty: "EC", crv: "P-256", x: "x", y: "y", kid: "runtime-key" },
			"2026-08-30T00:00:00.000Z",
		);
		const approval: ReleaseApproval = {
			operator_id: "operator-runtime",
			candidate_id: candidate.payload.candidate_id,
			release_id: candidate.payload.release_id,
			content_checksum: candidate.content_checksum,
			signature: candidate.signature,
			validation_set_checksum: candidate.validation_set_checksum,
			warnings_acknowledged: [],
			approved_at: "2026-08-30T00:01:00.000Z",
			reauthenticated_at: "2026-08-30T00:00:30.000Z",
		};
		expect(await persistReleaseApproval(env.DB, approval)).toBe(true);
		const repository = createD1FrontReleaseRepository(env.DB);
		const stored = await repository.getCandidate(candidate.payload.candidate_id);
		if (!stored) throw new Error("candidate was not persisted");
		const reauthentication = await createOperatorReauthenticationReceipt({
			receipt_id: "activation-runtime-reauth",
			operator_id: approval.operator_id,
			instance_id: "vocostar",
			action: "front_release.activate",
			candidate_id: candidate.payload.candidate_id,
			reauthenticated_at: "2026-08-30T00:01:30.000Z",
			expires_at: "2026-08-30T00:06:30.000Z",
		});
		expect(
			await repository.compareAndSwapActive({
				candidate: stored,
				command: {
					instance_id: "vocostar",
					candidate_id: candidate.payload.candidate_id,
					activation_id: "activation-runtime",
					expected_active_release_id: null,
					approval,
					reauthentication,
					activated_at: "2026-08-30T00:02:00.000Z",
				},
			}),
		).toMatchObject({ status: "activated", pointer_revision: 1 });
		expect(
			await repository.compareAndSwapActive({
				candidate: stored,
				command: {
					instance_id: "vocostar",
					candidate_id: candidate.payload.candidate_id,
					activation_id: "activation-stale",
					expected_active_release_id: null,
					approval,
					reauthentication,
					activated_at: "2026-08-30T00:03:00.000Z",
				},
			}),
		).toMatchObject({ status: "conflict", active_release_id: "release-runtime" });
		const outbox = await env.DB.prepare(
			"SELECT COUNT(*) AS count FROM superboard_front_outbox WHERE event_type = 'front_release.activated'",
		).first<{ count: number }>();
		expect(outbox?.count).toBe(1);
	});

	test("smokes preview, activation cache reload and pointer rollback without recompilation", async () => {
		const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
			"sign",
			"verify",
		]);
		const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
		const first = await compileFrontRelease(
			await frontReleaseInput({
				candidateId: "01J00000000000000000000101",
				releaseId: "01J00000000000000000000102",
				previousReleaseId: null,
				releaseSequence: 1,
			}),
			{ kid: "smoke-key", private_key: keys.privateKey },
		);
		await stageCompiledFrontRelease(
			env.DB,
			first,
			{ ...publicJwk, kid: "smoke-key" },
			"2026-08-30T00:10:00.000Z",
		);
		const firstApproval = approvalFor(first, "2026-08-30T00:10:30.000Z");
		expect(await persistReleaseApproval(env.DB, firstApproval)).toBe(true);
		const repository = createD1FrontReleaseRepository(env.DB);
		const firstStored = await repository.getCandidate(first.payload.candidate_id);
		if (!firstStored) throw new Error("first candidate missing");
		const firstActivationReauthentication = await createOperatorReauthenticationReceipt({
			receipt_id: "smoke-activation-a-reauth",
			operator_id: firstApproval.operator_id,
			instance_id: "vocostar",
			action: "front_release.activate",
			candidate_id: first.payload.candidate_id,
			reauthenticated_at: "2026-08-30T00:10:30.000Z",
			expires_at: "2026-08-30T00:15:30.000Z",
		});
		expect(
			await repository.compareAndSwapActive({
				candidate: firstStored,
				command: {
					instance_id: "vocostar",
					candidate_id: first.payload.candidate_id,
					activation_id: "smoke-activation-a",
					expected_active_release_id: "release-runtime",
					approval: firstApproval,
					reauthentication: firstActivationReauthentication,
					activated_at: "2026-08-30T00:11:00.000Z",
				},
			}),
		).toMatchObject({ status: "activated" });

		const second = await compileFrontRelease(
			await frontReleaseInput({
				candidateId: "01J00000000000000000000103",
				releaseId: "01J00000000000000000000104",
				previousReleaseId: first.payload.release_id,
				releaseSequence: 2,
			}),
			{ kid: "smoke-key", private_key: keys.privateKey },
		);
		await stageCompiledFrontRelease(
			env.DB,
			second,
			{ ...publicJwk, kid: "smoke-key" },
			"2026-08-30T00:12:00.000Z",
		);
		const secondStored = await repository.getCandidate(second.payload.candidate_id);
		if (!secondStored) throw new Error("second candidate missing");
		const preview = createFrontPreview(secondStored, {
			preview_id: "smoke-preview",
			issued_at: "2026-08-30T00:12:00.000Z",
			expires_at: "2026-08-30T01:12:00.000Z",
		});
		await persistFrontPreview(env.DB, preview);
		const loadedPreview = await loadFrontPreview(
			env.DB,
			"smoke-preview",
			"2026-08-30T00:13:00.000Z",
		);
		if (!loadedPreview) throw new Error("preview missing");
		expect(
			(await resolvePreviewFrontPage(env, loadedPreview.candidate.release, "/login", undefined))
				.resolution.result,
		).toBe("rendered");
		expect(
			(
				await resolvePreviewFrontPage(env, loadedPreview.candidate.release, "/app/profile", {
					id: "operator-admin",
					email: "admin@example.com",
					name: "Admin",
					role: 50,
					disabled: false,
				})
			).resolution.result,
		).toBe("rendered");
		expect(
			(
				await resolvePreviewFrontPage(env, loadedPreview.candidate.release, "/app/profile", {
					id: "operator-editor",
					email: "editor@example.com",
					name: "Editor",
					role: 40,
					disabled: false,
				})
			).resolution.result,
		).toBe("forbidden");

		const secondApproval = approvalFor(second, "2026-08-30T00:13:30.000Z");
		expect(await persistReleaseApproval(env.DB, secondApproval)).toBe(true);
		const secondActivationReauthentication = await createOperatorReauthenticationReceipt({
			receipt_id: "smoke-activation-b-reauth",
			operator_id: secondApproval.operator_id,
			instance_id: "vocostar",
			action: "front_release.activate",
			candidate_id: second.payload.candidate_id,
			reauthenticated_at: "2026-08-30T00:13:30.000Z",
			expires_at: "2026-08-30T00:18:30.000Z",
		});
		expect(
			await repository.compareAndSwapActive({
				candidate: { ...secondStored, status: "approved", approval: secondApproval },
				command: {
					instance_id: "vocostar",
					candidate_id: second.payload.candidate_id,
					activation_id: "smoke-activation-b",
					expected_active_release_id: first.payload.release_id,
					approval: secondApproval,
					reauthentication: secondActivationReauthentication,
					activated_at: "2026-08-30T00:14:00.000Z",
				},
			}),
		).toMatchObject({ status: "activated", previous_release_id: first.payload.release_id });
		expect(
			await verifyActivationReceipts(env.DB, {
				activation_id: "smoke-activation-b",
				instance_id: "vocostar",
				active_release_id: second.payload.release_id,
				pointer_revision: 3,
			}),
		).toBe(true);
		await env.RELEASE_CACHE.delete("last_verified_release:vocostar");
		expect((await loadLastVerifiedFrontRelease(env, "vocostar"))?.release.payload.release_id).toBe(
			second.payload.release_id,
		);

		const active = await repository.getActive("vocostar");
		const rollbackTarget = await getCandidateByReleaseId(env.DB, first.payload.release_id);
		if (!active || !rollbackTarget) throw new Error("rollback state missing");
		const receipt = await createOperatorReauthenticationReceipt({
			receipt_id: "smoke-rollback-reauth",
			operator_id: "operator-runtime",
			instance_id: "vocostar",
			action: "front_release.rollback",
			candidate_id: rollbackTarget.release.payload.candidate_id,
			reauthenticated_at: "2026-08-30T00:14:00.000Z",
			expires_at: "2026-08-30T00:19:00.000Z",
		});
		const rollbackPlan = await planPointerRollback(
			active,
			rollbackTarget,
			receipt,
			"2026-08-30T00:15:00.000Z",
		);
		expect(rollbackPlan.status).toBe("ready");
		if (rollbackPlan.status !== "ready") throw new Error("rollback rejected");
		expect(
			await repository.compareAndSwapActive({
				candidate: rollbackTarget,
				command: {
					instance_id: "vocostar",
					candidate_id: rollbackTarget.release.payload.candidate_id,
					activation_id: "smoke-rollback-a",
					expected_active_release_id: rollbackPlan.expected_active_release_id,
					approval: firstApproval,
					reauthentication: receipt,
					activated_at: "2026-08-30T00:15:00.000Z",
				},
			}),
		).toMatchObject({ status: "activated", active_release_id: first.payload.release_id });
		await env.RELEASE_CACHE.delete("last_verified_release:vocostar");
		expect((await loadLastVerifiedFrontRelease(env, "vocostar"))?.release.payload.release_id).toBe(
			first.payload.release_id,
		);
	});
});

async function frontReleaseInput(input: {
	candidateId: string;
	releaseId: string;
	previousReleaseId: string | null;
	releaseSequence: number;
}): Promise<FrontReleaseInput> {
	const releaseInput = await composeUserFrontReleaseInput({
		instance_id: "vocostar",
		front_draft_id: "01J00000000000000000000110",
		draft_snapshot_id: "01J00000000000000000000111",
		compilation_id: input.candidateId,
		candidate_id: input.candidateId,
		release_id: input.releaseId,
		release_sequence: input.releaseSequence,
		previous_release_id: input.previousReleaseId,
		created_at: "2026-08-30T00:10:00.000Z",
		plugin_lock: [
			{
				plugin_id: userPluginManifest.plugin_id,
				version: userPluginManifest.plugin_version,
				artifact_checksum: userPluginManifest.artifact_checksum,
				native: false,
			},
		],
		created_at: "2026-08-30T00:10:00.000Z",
	});
	return {
		...releaseInput,
		front_route_manifest: {
			...releaseInput.front_route_manifest,
			routes: releaseInput.front_route_manifest.routes.map((route) => ({
				...route,
				dependencies: [],
			})),
		},
		dependency_policies: [],
	};
}

function approvalFor(candidate: CompiledFrontRelease, reauthenticatedAt: string): ReleaseApproval {
	return {
		operator_id: "operator-runtime",
		candidate_id: candidate.payload.candidate_id,
		release_id: candidate.payload.release_id,
		content_checksum: candidate.content_checksum,
		signature: candidate.signature,
		validation_set_checksum: candidate.validation_set_checksum,
		warnings_acknowledged: [],
		approved_at: reauthenticatedAt,
		reauthenticated_at: reauthenticatedAt,
	};
}
