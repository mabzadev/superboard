export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

export function isUlid(value: unknown): value is string {
	return typeof value === "string" && ULID_PATTERN.test(value);
}
