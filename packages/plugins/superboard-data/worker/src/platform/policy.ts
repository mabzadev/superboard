import type { Caller } from "./caller.js";
import { DataError } from "./http.js";

export const ACCESS_RULES = ["public", "authenticated", "owner", "service"] as const;
export type AccessRule = (typeof ACCESS_RULES)[number];

export function parseAccessRule(value: unknown, field: string): AccessRule {
	const rule = ACCESS_RULES.find((candidate) => candidate === value);
	if (rule) return rule;
	throw new DataError(422, "rule_invalid", `${field} must be one of ${ACCESS_RULES.join(", ")}`);
}

export function allows(rule: AccessRule, caller: Caller): boolean {
	if (caller.role === "service") return true;
	if (rule === "public") return true;
	if (rule === "service") return false;
	return caller.role === "authenticated";
}

export function assertAllowed(rule: AccessRule, caller: Caller, operation: string): void {
	if (allows(rule, caller)) return;
	if (caller.role === "anon" && rule !== "service")
		throw new DataError(401, "authentication_required", `Sign in to ${operation}`);
	throw new DataError(403, "access_denied", `This key cannot ${operation}`);
}

export function ownerScope(rule: AccessRule, caller: Caller): string | null {
	return rule === "owner" && caller.role === "authenticated" ? caller.userId : null;
}
