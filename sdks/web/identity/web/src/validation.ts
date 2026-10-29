import type {
	IdTokenBody,
	GetUserInfoBase,
	GetUserInfoRes,
	PostTokenByAuthCodeRes,
	PostTokenByRefreshTokenRes,
} from "@melody-auth/shared";

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
export function parseIdTokenBody(value: unknown): IdTokenBody {
	if (!idBody(value)) throw new Error("Invalid identity token claims");
	return value;
}
function user(value: unknown): value is GetUserInfoBase {
	return (
		record(value) &&
		["authId", "locale", "createdAt", "updatedAt"].every((key) => typeof value[key] === "string") &&
		(value.email === null || typeof value.email === "string") &&
		["firstName", "lastName"].every(
			(key) => value[key] == null || typeof value[key] === "string",
		) &&
		strings(value.roles) &&
		typeof value.emailVerified === "boolean"
	);
}
export function parseUserInfo(value: unknown): GetUserInfoRes {
	if (
		!user(value) ||
		!("linkedAccount" in value) ||
		(value.linkedAccount !== null && !user(value.linkedAccount)) ||
		("attributes" in value && !attributes(value.attributes))
	)
		throw new Error("Invalid user information response");
	return { ...value, linkedAccount: value.linkedAccount };
}
function token(value: unknown): value is PostTokenByRefreshTokenRes {
	return (
		record(value) &&
		typeof value.access_token === "string" &&
		typeof value.expires_in === "number" &&
		typeof value.expires_on === "number" &&
		value.token_type === "Bearer"
	);
}
export function parseRefreshResponse(value: unknown): PostTokenByRefreshTokenRes {
	if (!token(value)) throw new Error("Invalid token response");
	return value;
}
export function parseAuthorizationResponse(value: unknown): PostTokenByAuthCodeRes {
	if (
		!token(value) ||
		!("not_before" in value) ||
		typeof value.not_before !== "number" ||
		!("scope" in value) ||
		typeof value.scope !== "string"
	)
		throw new Error("Invalid authorization response");
	return { ...value, not_before: value.not_before, scope: value.scope };
}
