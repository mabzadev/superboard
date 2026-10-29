import { expect, test } from "vitest";
import {
	isAuthorizationResponse,
	isIdTokenBody,
	isRefreshResponse,
	isUserInfo,
} from "../../../../../../../sdks/web/identity/web/src/validation.js";

const token = {
	access_token: "access",
	expires_in: 60,
	expires_on: 2000000000,
	token_type: "Bearer",
};
test("token responses reject invalid expiration and preserve authorization tokens", () => {
	expect(isRefreshResponse(token)).toBe(true);
	expect(isRefreshResponse({ ...token, expires_on: "tomorrow" })).toBe(false);
	const authorization = {
		...token,
		not_before: 0,
		scope: "openid",
		id_token: "identity",
		refresh_token: "refresh",
	};
	expect(isAuthorizationResponse(authorization)).toBe(true);
	expect(isAuthorizationResponse({ ...authorization, scope: 1 })).toBe(false);
});
test("invalid identity and user information cannot be stored as authenticated accounts", () => {
	expect(isIdTokenBody({ sub: "user", exp: "forever" })).toBe(false);
	expect(isUserInfo({ authId: "user", roles: [1] })).toBe(false);
});
