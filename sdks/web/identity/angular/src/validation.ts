import type { RefreshTokenStorage, IdTokenBody, IdTokenStorage } from "@melody-auth/shared";

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}
function attributes(value: unknown) {
	return (
		value === undefined ||
		(record(value) && Object.values(value).every((item) => typeof item === "string"))
	);
}
function idBody(value: unknown): value is IdTokenBody {
	return (
		record(value) &&
		["iss", "sub", "azp", "aud", "locale"].every((key) => typeof value[key] === "string") &&
		["exp", "iat"].every((key) => typeof value[key] === "number") &&
		["email", "first_name", "last_name"].every(
			(key) => value[key] === null || typeof value[key] === "string",
		) &&
		(value.roles === undefined || strings(value.roles)) &&
		attributes(value.attributes)
	);
}
export function parseIdTokenStorage(text: string): IdTokenStorage {
	const value: unknown = JSON.parse(text);
	if (!record(value) || typeof value.idToken !== "string" || !idBody(value.account))
		throw new Error("Invalid stored identity token");
	return { idToken: value.idToken, account: value.account };
}
export function parseRefreshTokenStorage(text: string): RefreshTokenStorage {
	const value: unknown = JSON.parse(text);
	if (
		!record(value) ||
		typeof value.refreshToken !== "string" ||
		typeof value.expiresOn !== "number" ||
		typeof value.expiresIn !== "number"
	)
		throw new Error("Invalid stored refresh token");
	return {
		refreshToken: value.refreshToken,
		expiresOn: value.expiresOn,
		expiresIn: value.expiresIn,
	};
}
