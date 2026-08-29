import type { CompiledFrontRelease } from "./contracts.js";
import type { ReleaseApproval } from "./front-activation.js";

export function parseCompiledFrontReleaseJson(value: string): CompiledFrontRelease {
	const parsed: unknown = JSON.parse(value);
	if (!isCompiledFrontRelease(parsed)) throw new TypeError("Stored Front Release is malformed");
	return parsed;
}

export function parseReleaseApprovalJson(value: string): ReleaseApproval {
	const parsed: unknown = JSON.parse(value);
	if (!isReleaseApproval(parsed)) throw new TypeError("Stored Release Approval is malformed");
	return parsed;
}

function isCompiledFrontRelease(value: unknown): value is CompiledFrontRelease {
	if (!isRecord(value) || !isRecord(value.payload) || !isRecord(value.signature)) return false;
	return (
		typeof value.payload.instance_id === "string" &&
		typeof value.payload.candidate_id === "string" &&
		typeof value.payload.release_id === "string" &&
		typeof value.content_checksum === "string" &&
		value.signature.algorithm === "ES256" &&
		typeof value.signature.kid === "string" &&
		typeof value.signature.value === "string" &&
		Array.isArray(value.validation_receipts) &&
		typeof value.validation_set_checksum === "string" &&
		value.verification_status === "verified"
	);
}

function isReleaseApproval(value: unknown): value is ReleaseApproval {
	if (!isRecord(value) || !isRecord(value.signature)) return false;
	return (
		typeof value.operator_id === "string" &&
		typeof value.candidate_id === "string" &&
		typeof value.release_id === "string" &&
		typeof value.content_checksum === "string" &&
		value.signature.algorithm === "ES256" &&
		typeof value.signature.kid === "string" &&
		typeof value.signature.value === "string" &&
		typeof value.validation_set_checksum === "string" &&
		Array.isArray(value.warnings_acknowledged) &&
		value.warnings_acknowledged.every((warning) => typeof warning === "string") &&
		typeof value.approved_at === "string" &&
		typeof value.reauthenticated_at === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
