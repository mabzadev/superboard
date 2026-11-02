import type { VersionStatus } from "./db/types.js";

export type AuditEnforcement = "none" | "flag" | "block";

export function getAuditEnforcement(env: Env): AuditEnforcement {
	const val = env.AUDIT_ENFORCEMENT;
	if (val === "none" || val === "flag" || val === "block") return val;
	return "flag";
}

export function resolveVersionStatus(
	enforcement: AuditEnforcement,
	codeVerdict: string | null,
	imageVerdict: string | null,
): VersionStatus {
	if (enforcement === "none") return "published";

	const code = codeVerdict ?? "pass";
	const image = imageVerdict ?? "pass";

	if (enforcement === "flag") {
		if (code === "pass" && image === "pass") return "published";
		return "flagged";
	}

	if (code === "fail" || image === "fail") return "rejected";
	if (code === "warn" || image === "warn") return "flagged";
	return "published";
}
