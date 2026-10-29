import type {
	GetUserInfoBase,
	GetUserInfoRes,
	PostTokenByAuthCodeRes,
	PostTokenByRefreshTokenRes,
} from "@melody-auth/shared";
import type { IdTokenBody } from "@melody-auth/shared";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isStringMap(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
export function isIdTokenBody(value: unknown): value is IdTokenBody {
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

function optionalStrings(value: Record<string, unknown>, keys: string[]) {
	return keys.every((key) => value[key] === undefined || typeof value[key] === "string");
}
function optionalNumbers(value: Record<string, unknown>, keys: string[]) {
	return keys.every(
		(key) =>
			value[key] === undefined || (typeof value[key] === "number" && Number.isFinite(value[key])),
	);
}
function userInfoBase(value: unknown): value is GetUserInfoBase {
	return (
		isRecord(value) &&
		["authId", "locale", "createdAt", "updatedAt"].every((key) => typeof value[key] === "string") &&
		(value.email === null || typeof value.email === "string") &&
		typeof value.emailVerified === "boolean" &&
		Array.isArray(value.roles) &&
		value.roles.every((entry) => typeof entry === "string") &&
		["firstName", "lastName"].every(
			(key) => value[key] === undefined || value[key] === null || typeof value[key] === "string",
		)
	);
}
export function isUserInfo(value: unknown): value is GetUserInfoRes {
	return (
		userInfoBase(value) &&
		isRecord(value) &&
		(value.linkedAccount === null || userInfoBase(value.linkedAccount)) &&
		(value.attributes === undefined || isStringMap(value.attributes))
	);
}
export function isRefreshResponse(value: unknown): value is PostTokenByRefreshTokenRes {
	return (
		isRecord(value) &&
		typeof value.access_token === "string" &&
		value.token_type === "Bearer" &&
		typeof value.expires_in === "number" &&
		Number.isFinite(value.expires_in) &&
		typeof value.expires_on === "number" &&
		Number.isFinite(value.expires_on)
	);
}
export function isAuthorizationResponse(value: unknown): value is PostTokenByAuthCodeRes {
	return (
		isRefreshResponse(value) &&
		isRecord(value) &&
		typeof value.not_before === "number" &&
		typeof value.scope === "string" &&
		optionalStrings(value, ["refresh_token", "id_token"]) &&
		optionalNumbers(value, ["refresh_token_expires_in", "refresh_token_expires_on"])
	);
}
