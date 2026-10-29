import { expect, test } from "vitest";
import {
	parseRefreshResponse,
	parseAuthorizationResponse,
	parseIdTokenBody,
	parseUserInfo,
} from "../../../../../../../sdks/web/identity/web/src/validation.js";

const token = {
	access_token: "access",
	expires_in: 60,
	expires_on: 2000000000,
	token_type: "Bearer",
};
test("token responses reject invalid expiration and preserve authorization tokens", () => {
	expect(parseRefreshResponse(token)).toEqual(token);
	expect(() => parseRefreshResponse({ ...token, expires_on: "tomorrow" })).toThrow();
	const authorization = {
		...token,
		not_before: 0,
		scope: "openid",
		id_token: "identity",
		refresh_token: "refresh",
	};
	expect(parseAuthorizationResponse(authorization)).toEqual(authorization);
	expect(() => parseAuthorizationResponse({ ...authorization, scope: 1 })).toThrow();
});
test("invalid identity and user information cannot be stored as authenticated accounts", () => {
	expect(() => parseIdTokenBody({ sub: "user", exp: "forever" })).toThrow();
	expect(() => parseUserInfo({ authId: "user", roles: [1] })).toThrow();
});
