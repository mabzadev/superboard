import type {
	AccessTokenStorage,
	RefreshTokenStorage,
	IdTokenBody,
	IdTokenStorage,
} from "@melody-auth/shared";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isStringMap(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
function isIdTokenBody(value: unknown): value is IdTokenBody {
	if (!isRecord(value)) return false;
	return (
		["iss", "sub", "azp", "aud", "locale"].every((key) => typeof value[key] === "string") &&
		["exp", "iat"].every((key) => typeof value[key] === "number" && Number.isFinite(value[key])) &&
		["email", "first_name", "last_name"].every(
			(key) => value[key] === null || typeof value[key] === "string",
		) &&
		(value.roles === undefined ||
			(Array.isArray(value.roles) && value.roles.every((entry) => typeof entry === "string"))) &&
		(value.attributes === undefined || isStringMap(value.attributes))
	);
}
function parsed(value: string | null): unknown {
	if (!value) return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}
export function readAccessTokenStorage(raw: string | null): AccessTokenStorage | null {
	const value = parsed(raw);
	if (
		!isRecord(value) ||
		typeof value.accessToken !== "string" ||
		typeof value.expiresIn !== "number" ||
		typeof value.expiresOn !== "number"
	)
		return null;
	return { accessToken: value.accessToken, expiresIn: value.expiresIn, expiresOn: value.expiresOn };
}
export function readRefreshTokenStorage(raw: string | null): RefreshTokenStorage | null {
	const value = parsed(raw);
	if (
		!isRecord(value) ||
		typeof value.refreshToken !== "string" ||
		typeof value.expiresIn !== "number" ||
		typeof value.expiresOn !== "number"
	)
		return null;
	return {
		refreshToken: value.refreshToken,
		expiresIn: value.expiresIn,
		expiresOn: value.expiresOn,
	};
}
export function readIdTokenStorage(raw: string | null): IdTokenStorage | null {
	const value = parsed(raw);
	if (!isRecord(value) || typeof value.idToken !== "string" || !isIdTokenBody(value.account))
		return null;
	return { idToken: value.idToken, account: value.account };
}
