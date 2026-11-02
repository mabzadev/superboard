import satisfies from "semver/functions/satisfies.js";
import valid from "semver/functions/valid.js";
import validRange from "semver/ranges/valid.js";

export interface HostEnv {
	[key: string]: string | undefined;
}

export interface EnvMismatch {
	key: string;
	required: string;
	host: string;
}

const ENV_KEY_RE = /^env:[^:]+$/;
const DID_KEY_RE = /^did:[a-z]+:.+$/;

export function hostEnvFromVersions(
	emdashVersion: string | undefined,
	astroVersion: string | undefined,
): HostEnv {
	const host: HostEnv = {};
	if (emdashVersion && emdashVersion !== "dev") host["env:emdash"] = emdashVersion;
	if (astroVersion) host["env:astro"] = astroVersion;
	return host;
}

export function parseRequires(value: unknown): Record<string, string> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
	const out: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (typeof raw !== "string") continue;
		if (!ENV_KEY_RE.test(key) && !DID_KEY_RE.test(key)) continue;
		out[key] = raw;
	}
	return out;
}

export function isValidVersionRange(range: string): boolean {
	if (range.trim() === "") return false;
	return validRange(range) !== null;
}

export function satisfiesRange(version: string, range: string): boolean {
	if (valid(version) === null) return true;
	if (validRange(range) === null) return true;
	return satisfies(version, range, { includePrerelease: true });
}

export function checkEnvCompatibility(requires: unknown, host: HostEnv): EnvMismatch[] {
	const parsed = parseRequires(requires);
	const mismatches: EnvMismatch[] = [];
	for (const [key, range] of Object.entries(parsed)) {
		const hostVersion = host[key];
		if (hostVersion === undefined) continue;
		if (!satisfiesRange(hostVersion, range)) {
			mismatches.push({ key, required: range, host: hostVersion });
		}
	}
	return mismatches;
}

export interface SkippedEnvConstraint {
	key: string;
	required: string;
	reason: "unknown" | "unparseable";
}

export function findSkippedEnvConstraints(
	requires: unknown,
	host: HostEnv,
): SkippedEnvConstraint[] {
	const parsed = parseRequires(requires);
	const skipped: SkippedEnvConstraint[] = [];
	for (const [key, range] of Object.entries(parsed)) {
		if (!ENV_KEY_RE.test(key)) continue;
		const hostVersion = host[key];
		if (hostVersion === undefined) {
			skipped.push({ key, required: range, reason: "unknown" });
		} else if (valid(hostVersion) === null) {
			skipped.push({ key, required: range, reason: "unparseable" });
		}
	}
	return skipped;
}
