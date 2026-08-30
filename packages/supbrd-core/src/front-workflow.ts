import { canonicalizeReleasePayload } from "./canonical-json.js";
import type { FrontReleaseVerification } from "./contracts.js";
import type {
	ActiveFrontReleasePointer,
	FrontReleaseCandidateRecord,
	ReleaseApproval,
} from "./front-activation.js";

export interface FrontDraft {
	front_draft_id: string;
	instance_id: string;
	revision: number;
	input: unknown;
	updated_at: string;
}

export interface DraftSnapshot {
	draft_snapshot_id: string;
	front_draft_id: string;
	instance_id: string;
	draft_revision: number;
	input: unknown;
	created_at: string;
}

export interface OperatorReauthenticationReceipt {
	receipt_id: string;
	operator_id: string;
	instance_id: string;
	action: "front_release.approve" | "front_release.activate" | "front_release.rollback";
	candidate_id: string;
	reauthenticated_at: string;
	expires_at: string;
	receipt_checksum: string;
}

export interface FrontReleaseCandidateEvidence {
	signing_key_status: "active" | "retired" | "missing";
	verification: FrontReleaseVerification;
	dependencies_ready: boolean;
	renderers_ready: boolean;
	gateway_ready: boolean;
	stores_ready: boolean;
	migrations_ready: boolean;
	workers_ready: boolean;
	secrets_ready: boolean;
	media_ready: boolean;
	rollback_ready: boolean;
}

export function updateFrontDraft(
	current: FrontDraft,
	command: { expected_draft_revision: number; input: unknown; updated_at: string },
): { status: "updated"; draft: FrontDraft } | { status: "conflict"; current_revision: number } {
	if (command.expected_draft_revision !== current.revision) {
		return { status: "conflict", current_revision: current.revision };
	}
	return {
		status: "updated",
		draft: {
			...current,
			revision: current.revision + 1,
			input: cloneJson(command.input),
			updated_at: canonicalTimestamp(command.updated_at, "updated_at"),
		},
	};
}

export function snapshotFrontDraft(
	draft: FrontDraft,
	draftSnapshotId: string,
	createdAt: string,
): DraftSnapshot {
	return Object.freeze({
		draft_snapshot_id: required(draftSnapshotId, "draft_snapshot_id"),
		front_draft_id: draft.front_draft_id,
		instance_id: draft.instance_id,
		draft_revision: draft.revision,
		input: cloneJson(draft.input),
		created_at: canonicalTimestamp(createdAt, "created_at"),
	});
}

export function createFrontPreview(
	candidate: FrontReleaseCandidateRecord,
	input: { preview_id: string; issued_at: string; expires_at: string },
) {
	if (candidate.status !== "validated" && candidate.status !== "approved") {
		throw new Error("Only a validated or approved candidate can be previewed");
	}
	const issued = timestamp(input.issued_at, "issued_at");
	const expires = timestamp(input.expires_at, "expires_at");
	if (expires <= issued || expires - issued > 24 * 60 * 60 * 1_000) {
		throw new Error("Front preview expiration must be within 24 hours");
	}
	return Object.freeze({
		preview_id: required(input.preview_id, "preview_id"),
		audience: "front_preview" as const,
		candidate_id: candidate.release.payload.candidate_id,
		release_id: candidate.release.payload.release_id,
		content_checksum: candidate.release.content_checksum,
		issued_at: input.issued_at,
		expires_at: input.expires_at,
		mutation_mode: "dry_run" as const,
		release: structuredClone(candidate.release),
	});
}

export async function createOperatorReauthenticationReceipt(
	input: Omit<OperatorReauthenticationReceipt, "receipt_checksum">,
): Promise<OperatorReauthenticationReceipt> {
	const reauthenticated = timestamp(input.reauthenticated_at, "reauthenticated_at");
	const expires = timestamp(input.expires_at, "expires_at");
	if (expires <= reauthenticated || expires - reauthenticated > 5 * 60 * 1_000) {
		throw new Error("Strong reauthentication receipt expiration must be within five minutes");
	}
	const content = {
		...input,
		receipt_id: required(input.receipt_id, "receipt_id"),
		operator_id: required(input.operator_id, "operator_id"),
		instance_id: required(input.instance_id, "instance_id"),
		candidate_id: required(input.candidate_id, "candidate_id"),
	};
	return { ...content, receipt_checksum: await checksum(content) };
}

export async function validateOperatorReauthenticationReceipt(
	receipt: OperatorReauthenticationReceipt,
	candidate: FrontReleaseCandidateRecord,
	input: {
		action: OperatorReauthenticationReceipt["action"];
		operator_id: string;
		action_at: string;
	},
): Promise<string | null> {
	if (receipt.operator_id !== input.operator_id) return "REAUTHENTICATION_RECEIPT_INVALID";
	return validateReauthentication(
		receipt,
		candidate,
		input.action,
		timestamp(input.action_at, "action_at"),
	);
}

export async function approveFrontReleaseCandidate(
	candidate: FrontReleaseCandidateRecord,
	input: {
		reauthentication: OperatorReauthenticationReceipt;
		approved_at: string;
		warnings_acknowledged: string[];
	},
): Promise<
	| { status: "approved"; approval: ReleaseApproval; reauthentication_receipt_id: string }
	| { status: "rejected"; code: string }
> {
	if (candidate.status !== "validated") {
		return { status: "rejected", code: "CANDIDATE_NOT_VALIDATED" };
	}
	const approvedAt = timestamp(input.approved_at, "approved_at");
	const acknowledged = new Set(input.warnings_acknowledged);
	const missingWarnings = candidate.release.validation_receipts
		.filter(({ level }) => level === "warning")
		.some(({ receipt_id: receiptId }) => !acknowledged.has(receiptId));
	if (missingWarnings) return { status: "rejected", code: "WARNINGS_NOT_ACKNOWLEDGED" };
	const receiptError = await validateReauthentication(
		input.reauthentication,
		candidate,
		"front_release.approve",
		approvedAt,
	);
	if (receiptError) return { status: "rejected", code: receiptError };
	return {
		status: "approved",
		reauthentication_receipt_id: input.reauthentication.receipt_id,
		approval: {
			operator_id: input.reauthentication.operator_id,
			candidate_id: candidate.release.payload.candidate_id,
			release_id: candidate.release.payload.release_id,
			content_checksum: candidate.release.content_checksum,
			signature: candidate.release.signature,
			validation_set_checksum: candidate.release.validation_set_checksum,
			warnings_acknowledged: [...acknowledged].toSorted(),
			approved_at: input.approved_at,
			reauthenticated_at: input.reauthentication.reauthenticated_at,
		},
	};
}

export function validateFrontReleaseCandidate(
	_candidate: FrontReleaseCandidateRecord,
	evidence: FrontReleaseCandidateEvidence,
): FrontReleaseVerification {
	const errors = [...evidence.verification.errors];
	if (evidence.signing_key_status === "retired") errors.push("SIGNING_KEY_RETIRED");
	if (evidence.signing_key_status === "missing") errors.push("SIGNING_KEY_MISSING");
	for (const [ready, code] of [
		[evidence.dependencies_ready, "DEPENDENCIES_NOT_READY"],
		[evidence.renderers_ready, "RENDERERS_NOT_READY"],
		[evidence.gateway_ready, "GATEWAY_NOT_READY"],
		[evidence.stores_ready, "STORES_NOT_READY"],
		[evidence.migrations_ready, "MIGRATIONS_NOT_READY"],
		[evidence.workers_ready, "WORKERS_NOT_READY"],
		[evidence.secrets_ready, "SECRETS_NOT_READY"],
		[evidence.media_ready, "MEDIA_NOT_READY"],
		[evidence.rollback_ready, "ROLLBACK_NOT_READY"],
	] as const) {
		if (!ready) errors.push(code);
	}
	return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export async function planPointerRollback(
	active: ActiveFrontReleasePointer,
	target: FrontReleaseCandidateRecord,
	reauthentication: OperatorReauthenticationReceipt,
	rolledBackAt: string,
): Promise<
	| {
			status: "ready";
			target_release_id: string;
			expected_active_release_id: string;
			pointer_revision: number;
	  }
	| { status: "rejected"; code: string }
> {
	const rollbackAt = timestamp(rolledBackAt, "rolled_back_at");
	if (active.previous_release_id !== target.release.payload.release_id) {
		return { status: "rejected", code: "ROLLBACK_TARGET_MISMATCH" };
	}
	if (
		target.release.payload.rollback.classification !== "pointer_only" ||
		target.release.payload.rollback.conditions.length > 0
	) {
		return { status: "rejected", code: "ROLLBACK_RESTORE_REQUIRED" };
	}
	const receiptError = await validateReauthentication(
		reauthentication,
		target,
		"front_release.rollback",
		rollbackAt,
	);
	if (receiptError) return { status: "rejected", code: receiptError };
	return {
		status: "ready",
		target_release_id: target.release.payload.release_id,
		expected_active_release_id: active.active_release_id,
		pointer_revision: active.pointer_revision + 1,
	};
}

async function validateReauthentication(
	receipt: OperatorReauthenticationReceipt,
	candidate: FrontReleaseCandidateRecord,
	action: OperatorReauthenticationReceipt["action"],
	actionAt: number,
): Promise<string | null> {
	const { receipt_checksum: receiptChecksum, ...content } = receipt;
	if (
		(await checksum(content)) !== receiptChecksum ||
		receipt.action !== action ||
		receipt.instance_id !== candidate.release.payload.instance_id ||
		receipt.candidate_id !== candidate.release.payload.candidate_id
	) {
		return "REAUTHENTICATION_RECEIPT_INVALID";
	}
	const reauthenticated = timestamp(receipt.reauthenticated_at, "reauthenticated_at");
	const expires = timestamp(receipt.expires_at, "expires_at");
	if (actionAt < reauthenticated || actionAt > expires) return "STRONG_REAUTH_EXPIRED";
	return null;
}

function cloneJson<T>(value: T): T {
	return structuredClone(value);
}

function required(value: string, field: string): string {
	if (value.trim() === "") throw new Error(`${field} is required`);
	return value;
}

function timestamp(value: string, field: string): number {
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
		throw new Error(`${field} must be a canonical UTC timestamp`);
	}
	return parsed;
}

function canonicalTimestamp(value: string, field: string): string {
	timestamp(value, field);
	return value;
}

async function checksum(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(canonicalizeReleasePayload(value));
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
	return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
