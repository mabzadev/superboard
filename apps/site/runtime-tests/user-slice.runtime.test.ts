import {
	activateFrontRelease,
	approveFrontReleaseCandidate,
	compileFrontRelease,
	createFrontPreview,
	createOperatorReauthenticationReceipt,
	validateFrontReleaseCandidate,
} from "@superboard/supbrd-core";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";

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
import { composeUserFrontReleaseInput } from "../src/lib/user-front-release.js";

test("produces candidate, preview, approval and activation evidence for the user slice", async () => {
	const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	]);
	const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
	const release = await compileFrontRelease(
		await composeUserFrontReleaseInput({
			instance_id: "vocostar",
			front_draft_id: "01J00000000000000000000401",
			draft_snapshot_id: "01J00000000000000000000402",
			compilation_id: "01J00000000000000000000403",
			candidate_id: "01J00000000000000000000404",
			release_id: "01J00000000000000000000405",
			created_at: "2026-08-30T00:55:00.000Z",
		}),
		{ kid: "user-slice-runtime-key", private_key: keys.privateKey },
	);
	await stageCompiledFrontRelease(
		env.DB,
		release,
		{ ...publicJwk, kid: "user-slice-runtime-key" },
		"2026-08-30T00:55:00.000Z",
	);
	await env.DB.prepare(
		`INSERT OR REPLACE INTO superboard_dependency_health
		 (instance_id, dependency_id, status, evidence_checksum, checked_at, expires_at)
		 VALUES ('vocostar', 'dependency.supbrd_plug_user', 'ready', ?, ?, ?)`,
	)
		.bind(
			`sha256:${"a".repeat(64)}`,
			new Date().toISOString(),
			new Date(Date.now() + 60_000).toISOString(),
		)
		.run();
	const candidate = await getFrontReleaseCandidate(env.DB, release.payload.candidate_id);
	if (!candidate) throw new Error("user candidate missing");
	const preview = createFrontPreview(candidate, {
		preview_id: "user-slice-runtime-preview",
		issued_at: "2026-08-30T00:55:00.000Z",
		expires_at: "2026-08-30T01:55:00.000Z",
	});
	await persistFrontPreview(env.DB, preview);

	const reauthentication = await createOperatorReauthenticationReceipt({
		receipt_id: "user-slice-runtime-reauth",
		operator_id: "operator-runtime",
		instance_id: "vocostar",
		action: "front_release.approve",
		candidate_id: release.payload.candidate_id,
		reauthenticated_at: "2026-08-30T00:55:00.000Z",
		expires_at: "2026-08-30T01:00:00.000Z",
	});
	const approvalResult = await approveFrontReleaseCandidate(candidate, {
		reauthentication,
		approved_at: "2026-08-30T00:56:00.000Z",
		warnings_acknowledged: release.validation_receipts
			.filter(({ level }) => level === "warning")
			.map(({ receipt_id: receiptId }) => receiptId),
	});
	expect(approvalResult.status).toBe("approved");
	if (approvalResult.status !== "approved") throw new Error("user approval failed");
	await persistReauthenticationReceipt(env.DB, reauthentication, "2026-08-30T00:56:00.000Z");
	expect(
		await persistReleaseApproval(env.DB, approvalResult.approval, reauthentication.receipt_id),
	).toBe(true);
	const approved = await getFrontReleaseCandidate(env.DB, release.payload.candidate_id);
	if (!approved) throw new Error("approved user candidate missing");
	expect(
		validateFrontReleaseCandidate(approved, await candidateEvidence(env.DB, approved)),
	).toEqual({
		valid: true,
		errors: [],
	});
	const repository = createD1FrontReleaseRepository(env.DB);
	const active = await repository.getActive("vocostar");
	const activationReauthentication = await createOperatorReauthenticationReceipt({
		receipt_id: "user-slice-runtime-activation-reauth",
		operator_id: "operator-runtime",
		instance_id: "vocostar",
		action: "front_release.activate",
		candidate_id: release.payload.candidate_id,
		reauthenticated_at: "2026-08-30T00:56:30.000Z",
		expires_at: "2026-08-30T01:01:30.000Z",
	});
	const activation = await activateFrontRelease(repository, {
		instance_id: "vocostar",
		candidate_id: release.payload.candidate_id,
		activation_id: "user-slice-runtime-activation",
		expected_active_release_id: active?.active_release_id ?? null,
		approval: approvalResult.approval,
		reauthentication: activationReauthentication,
		activated_at: "2026-08-30T00:57:00.000Z",
	});
	expect(activation.status).toBe("activated");
	if (activation.status !== "activated") throw new Error("user activation failed");
	expect(
		await verifyActivationReceipts(env.DB, {
			activation_id: activation.activation_id,
			instance_id: "vocostar",
			active_release_id: activation.active_release_id,
			pointer_revision: activation.pointer_revision,
		}),
	).toBe(true);
	const activationReauthenticationLink = await env.DB.prepare(
		`SELECT linked.activation_id, receipt.action, receipt.candidate_id,
		        receipt.receipt_checksum
		 FROM superboard_front_activation_reauthentication linked
		 JOIN superboard_operator_reauthentication_receipts receipt
		   ON receipt.receipt_id = linked.receipt_id
		 WHERE linked.activation_id = ?`,
	)
		.bind(activation.activation_id)
		.first();
	expect(activationReauthenticationLink).toEqual({
		activation_id: activation.activation_id,
		action: "front_release.activate",
		candidate_id: release.payload.candidate_id,
		receipt_checksum: activationReauthentication.receipt_checksum,
	});
});
