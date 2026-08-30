import { canonicalizeReleasePayload } from "./canonical-json.js";
import type { CompiledFrontRelease, ReleaseSignature } from "./contracts.js";
import {
	validateOperatorReauthenticationReceipt,
	type OperatorReauthenticationReceipt,
} from "./front-workflow.js";

export interface ReleaseApproval {
	operator_id: string;
	candidate_id: string;
	release_id: string;
	content_checksum: string;
	signature: ReleaseSignature;
	validation_set_checksum: string;
	warnings_acknowledged: string[];
	approved_at: string;
	reauthenticated_at: string;
}

export interface FrontReleaseCandidateRecord {
	release: CompiledFrontRelease;
	status: "validated" | "approved" | "activated";
	approval: ReleaseApproval | null;
}

export interface ActiveFrontReleasePointer {
	instance_id: string;
	active_release_id: string;
	previous_release_id: string | null;
	pointer_revision: number;
	activation_id: string;
	activated_at: string;
}

export interface FrontReleaseActivationCommand {
	instance_id: string;
	candidate_id: string;
	activation_id: string;
	expected_active_release_id: string | null;
	approval: ReleaseApproval;
	reauthentication: OperatorReauthenticationReceipt;
	activated_at: string;
}

export type FrontReleaseActivationResult =
	| {
			status: "activated";
			active_release_id: string;
			previous_release_id: string | null;
			pointer_revision: number;
			activation_id: string;
	  }
	| { status: "conflict"; active_release_id: string | null; pointer_revision: number }
	| { status: "rejected"; code: string };

export interface FrontReleaseRepository {
	getCandidate(candidateId: string): Promise<FrontReleaseCandidateRecord | null>;
	getActive(instanceId: string): Promise<ActiveFrontReleasePointer | null>;
	compareAndSwapActive(input: {
		candidate: FrontReleaseCandidateRecord;
		command: FrontReleaseActivationCommand;
	}): Promise<FrontReleaseActivationResult>;
}

export async function activateFrontRelease(
	repository: FrontReleaseRepository,
	command: FrontReleaseActivationCommand,
): Promise<FrontReleaseActivationResult> {
	const candidate = await repository.getCandidate(command.candidate_id);
	if (!candidate) return { status: "rejected", code: "CANDIDATE_NOT_FOUND" };
	if (candidate.status !== "approved" && candidate.status !== "activated") {
		return { status: "rejected", code: "CANDIDATE_NOT_APPROVED" };
	}
	if (
		!candidate.approval ||
		!approvalMatches(candidate.release, candidate.approval, command.approval)
	) {
		return { status: "rejected", code: "APPROVAL_MISMATCH" };
	}
	if (candidate.release.payload.instance_id !== command.instance_id) {
		return { status: "rejected", code: "INSTANCE_MISMATCH" };
	}
	const reauthenticationError = await validateOperatorReauthenticationReceipt(
		command.reauthentication,
		candidate,
		{
			action: "front_release.activate",
			operator_id: candidate.approval.operator_id,
			action_at: command.activated_at,
		},
	);
	if (reauthenticationError) return { status: "rejected", code: reauthenticationError };
	return repository.compareAndSwapActive({ candidate, command });
}

export function createInMemoryFrontReleaseRepository(
	candidates: FrontReleaseCandidateRecord[] = [],
): FrontReleaseRepository {
	const candidateRecords = new Map(
		candidates.map((candidate) => [
			candidate.release.payload.candidate_id,
			structuredClone(candidate),
		]),
	);
	const activePointers = new Map<string, ActiveFrontReleasePointer>();

	return {
		async getCandidate(candidateId) {
			const candidate = candidateRecords.get(candidateId);
			return candidate ? structuredClone(candidate) : null;
		},
		async getActive(instanceId) {
			const pointer = activePointers.get(instanceId);
			return pointer ? structuredClone(pointer) : null;
		},
		async compareAndSwapActive({ candidate, command }) {
			const current = activePointers.get(command.instance_id) ?? null;
			if ((current?.active_release_id ?? null) !== command.expected_active_release_id) {
				return {
					status: "conflict",
					active_release_id: current?.active_release_id ?? null,
					pointer_revision: current?.pointer_revision ?? 0,
				};
			}

			const next: ActiveFrontReleasePointer = {
				instance_id: command.instance_id,
				active_release_id: candidate.release.payload.release_id,
				previous_release_id: current?.active_release_id ?? null,
				pointer_revision: (current?.pointer_revision ?? 0) + 1,
				activation_id: command.activation_id,
				activated_at: command.activated_at,
			};
			activePointers.set(command.instance_id, next);
			candidateRecords.set(command.candidate_id, { ...candidate, status: "activated" });
			return {
				status: "activated",
				active_release_id: next.active_release_id,
				previous_release_id: next.previous_release_id,
				pointer_revision: next.pointer_revision,
				activation_id: next.activation_id,
			};
		},
	};
}

function approvalMatches(
	release: CompiledFrontRelease,
	stored: ReleaseApproval,
	presented: ReleaseApproval,
): boolean {
	const expected = {
		candidate_id: release.payload.candidate_id,
		release_id: release.payload.release_id,
		content_checksum: release.content_checksum,
		signature: release.signature,
		validation_set_checksum: release.validation_set_checksum,
	};
	const storedIdentity = {
		candidate_id: stored.candidate_id,
		release_id: stored.release_id,
		content_checksum: stored.content_checksum,
		signature: stored.signature,
		validation_set_checksum: stored.validation_set_checksum,
	};
	return (
		canonicalizeReleasePayload(expected) === canonicalizeReleasePayload(storedIdentity) &&
		canonicalizeReleasePayload(stored) === canonicalizeReleasePayload(presented)
	);
}
