import { describe, expect, test } from "vitest";

import {
	activateFrontRelease,
	createOperatorReauthenticationReceipt,
	createInMemoryFrontReleaseRepository,
	type CompiledFrontRelease,
	type ReleaseApproval,
} from "../src/index.js";

function candidate(): CompiledFrontRelease {
	return {
		payload: {
			instance_id: "vocostar",
			candidate_id: "01J00000000000000000000011",
			release_id: "01J00000000000000000000012",
			previous_release_id: null,
		} as CompiledFrontRelease["payload"],
		content_checksum: `sha256:${"1".repeat(64)}`,
		signature: { algorithm: "ES256", kid: "release-key", value: "signature" },
		validation_receipts: [],
		validation_set_checksum: `sha256:${"2".repeat(64)}`,
		verification_status: "verified",
	};
}

function approval(release: CompiledFrontRelease): ReleaseApproval {
	return {
		operator_id: "operator-1",
		candidate_id: release.payload.candidate_id,
		release_id: release.payload.release_id,
		content_checksum: release.content_checksum,
		signature: release.signature,
		validation_set_checksum: release.validation_set_checksum,
		warnings_acknowledged: [],
		approved_at: "2026-08-29T18:30:00.000Z",
		reauthenticated_at: "2026-08-29T18:29:00.000Z",
	};
}

async function activationReauthentication(release: CompiledFrontRelease) {
	return createOperatorReauthenticationReceipt({
		receipt_id: "01J00000000000000000000019",
		operator_id: "operator-1",
		instance_id: release.payload.instance_id,
		action: "front_release.activate",
		candidate_id: release.payload.candidate_id,
		reauthenticated_at: "2026-08-29T18:29:00.000Z",
		expires_at: "2026-08-29T18:34:00.000Z",
	});
}

describe("Front Release activation", () => {
	test("accepts a fresh activation reauthentication independently of the immutable approval", async () => {
		const release = candidate();
		const releaseApproval = approval(release);
		const repository = createInMemoryFrontReleaseRepository([
			{ release, status: "approved", approval: releaseApproval },
		]);
		const activationReauthentication = await createOperatorReauthenticationReceipt({
			receipt_id: "01J00000000000000000000017",
			operator_id: releaseApproval.operator_id,
			instance_id: release.payload.instance_id,
			action: "front_release.activate",
			candidate_id: release.payload.candidate_id,
			reauthenticated_at: "2026-08-29T18:59:00.000Z",
			expires_at: "2026-08-29T19:04:00.000Z",
		});

		expect(
			await activateFrontRelease(repository, {
				instance_id: "vocostar",
				candidate_id: release.payload.candidate_id,
				activation_id: "01J00000000000000000000018",
				expected_active_release_id: null,
				approval: releaseApproval,
				reauthentication: activationReauthentication,
				activated_at: "2026-08-29T19:00:00.000Z",
			}),
		).toMatchObject({ status: "activated", active_release_id: release.payload.release_id });
	});

	test("activates once with compare-and-swap and keeps the pointer on a stale retry", async () => {
		const release = candidate();
		const releaseApproval = approval(release);
		const repository = createInMemoryFrontReleaseRepository([
			{ release, status: "approved", approval: releaseApproval },
		]);
		const reauthentication = await activationReauthentication(release);

		const activated = await activateFrontRelease(repository, {
			instance_id: "vocostar",
			candidate_id: release.payload.candidate_id,
			activation_id: "01J00000000000000000000013",
			expected_active_release_id: null,
			approval: releaseApproval,
			reauthentication,
			activated_at: "2026-08-29T18:31:00.000Z",
		});
		expect(activated).toMatchObject({
			status: "activated",
			active_release_id: release.payload.release_id,
			previous_release_id: null,
			pointer_revision: 1,
		});

		const staleRetry = await activateFrontRelease(repository, {
			instance_id: "vocostar",
			candidate_id: release.payload.candidate_id,
			activation_id: "01J00000000000000000000014",
			expected_active_release_id: null,
			approval: releaseApproval,
			reauthentication,
			activated_at: "2026-08-29T18:32:00.000Z",
		});
		expect(staleRetry).toEqual({
			status: "conflict",
			active_release_id: release.payload.release_id,
			pointer_revision: 1,
		});
		expect(await repository.getActive("vocostar")).toMatchObject({
			active_release_id: release.payload.release_id,
			pointer_revision: 1,
		});
	});

	test("rejects an approval mismatch and expired activation reauthentication", async () => {
		const release = candidate();
		const storedApproval = approval(release);
		const repository = createInMemoryFrontReleaseRepository([
			{ release, status: "approved", approval: storedApproval },
		]);
		const reauthentication = await activationReauthentication(release);
		const mismatched = structuredClone(storedApproval);
		mismatched.warnings_acknowledged = ["different-warning-set"];
		expect(
			await activateFrontRelease(repository, {
				instance_id: "vocostar",
				candidate_id: release.payload.candidate_id,
				activation_id: "01J00000000000000000000015",
				expected_active_release_id: null,
				approval: mismatched,
				reauthentication,
				activated_at: "2026-08-29T18:31:00.000Z",
			}),
		).toEqual({ status: "rejected", code: "APPROVAL_MISMATCH" });

		expect(
			await activateFrontRelease(repository, {
				instance_id: "vocostar",
				candidate_id: release.payload.candidate_id,
				activation_id: "01J00000000000000000000016",
				expected_active_release_id: null,
				approval: storedApproval,
				reauthentication,
				activated_at: "2026-08-29T18:35:00.001Z",
			}),
		).toEqual({ status: "rejected", code: "STRONG_REAUTH_EXPIRED" });
	});
});
