const identityClaims = {
	iss: "https://auth.example.test",
	sub: "user-1",
	azp: "client",
	aud: "client",
	exp: 0,
	iat: 0,
	email: null,
	first_name: null,
	last_name: null,
	locale: "en",
};
import type { ProviderConfig } from "@melody-auth/shared";
import { SessionStorageKey, StorageKey } from "@melody-auth/shared";
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";

import {
	exchangeTokenByAuthCode,
	loadCodeAndStateFromUrl,
} from "../../../../../../../../sdks/web/identity/web/src/flows/exchangeTokenByAuthCode";
import { postTokenByAuthCode } from "../../../../../../../../sdks/web/identity/web/src/requests";
import { identityClaims } from "../../../../../../../fixtures/identity/claims.js";

vi.mock("../../../../../../../../sdks/web/identity/web/src/requests", () => ({
	postTokenByAuthCode: vi.fn(),
}));
const mockedPostTokenByAuthCode = postTokenByAuthCode as unknown as ReturnType<typeof vi.fn>;

describe("exchangeTokenByAuthCode", () => {
	beforeEach(() => {
		window.sessionStorage.clear();
		window.localStorage.clear();
		vi.clearAllMocks();
	});

	afterEach(() => {
		window.history.replaceState({}, "", "/");
	});

	it("should return undefined if no code or state in URL query", async () => {
		window.history.pushState({}, "Test Title", "/?foo=bar");

		const config: ProviderConfig = { storage: "sessionStorage" } as any;
		const result = await exchangeTokenByAuthCode("", "", config);
		expect(result).toBeUndefined();
	});

	it("should return undefined if state is not found in sessionStorage", async () => {
		window.history.pushState({}, "Test Title", "/?code=authCode&state=someState");
		const config: ProviderConfig = { storage: "sessionStorage" } as any;
		const result = await exchangeTokenByAuthCode("authCode", "someState", config);
		expect(result).toBeUndefined();
	});

	it("should throw error if state does not match", async () => {
		window.history.pushState({}, "Test Title", "/?code=authCode&state=stateFromQuery");
		window.sessionStorage.setItem(SessionStorageKey.State, "differentState");
		const config: ProviderConfig = { storage: "sessionStorage" } as any;
		await expect(exchangeTokenByAuthCode("authCode", "strateFromQuery", config)).rejects.toThrow(
			"Invalid state",
		);
	});

	it("rejects a callback without its PKCE verifier before exchanging tokens", async () => {
		window.sessionStorage.setItem(SessionStorageKey.State, "validState");
		const config: ProviderConfig = {
			serverUri: "https://auth.example.test",
			clientId: "app",
			redirectUri: "https://app.example.test",
			storage: "sessionStorage",
		};
		await expect(exchangeTokenByAuthCode("code", "validState", config)).rejects.toThrow(
			"Missing code verifier",
		);
		expect(postTokenByAuthCode).not.toHaveBeenCalled();
		expect(window.sessionStorage.getItem(StorageKey.RefreshToken)).toBeNull();
	});

	it.each(["refresh_token_expires_in", "refresh_token_expires_on"])(
		"rejects a refresh token missing %s without storing it",
		async (missingField) => {
			window.sessionStorage.setItem(SessionStorageKey.State, "validState");
			window.sessionStorage.setItem(SessionStorageKey.CodeVerifier, "verifier");
			const response = {
				access_token: "access",
				expires_in: 300,
				expires_on: 1700000300,
				refresh_token: "refresh",
				refresh_token_expires_in: 600,
				refresh_token_expires_on: 1700000600,
			};
			mockedPostTokenByAuthCode.mockResolvedValueOnce({ ...response, [missingField]: undefined });
			const config: ProviderConfig = {
				serverUri: "https://auth.example.test",
				clientId: "app",
				redirectUri: "https://app.example.test",
				storage: "sessionStorage",
			};
			await expect(exchangeTokenByAuthCode("code", "validState", config)).rejects.toThrow(
				"Missing refresh token expiration",
			);
			expect(window.sessionStorage.getItem(StorageKey.RefreshToken)).toBeNull();
		},
	);

	it("should exchange token successfully with refresh_token and id_token", async () => {
		window.history.pushState({}, "Test Title", "/?code=authcode&state=validState");
		window.sessionStorage.setItem(SessionStorageKey.State, "validState");
		window.sessionStorage.setItem(SessionStorageKey.CodeVerifier, "verifierValue");

		const fakePayload = JSON.stringify(identityClaims({ sub: "12345" }));
		const encodedPayload = btoa(fakePayload);
		const fakeTokenResult = {
			access_token: "access123",
			expires_in: 3600,
			expires_on: "expiryTime",
			refresh_token: "refresh123",
			refresh_token_expires_in: 7200,
			refresh_token_expires_on: "refreshExpiry",
			id_token: `header.${encodedPayload}.signature`,
		};

		mockedPostTokenByAuthCode.mockResolvedValueOnce(fakeTokenResult);
		const replaceStateSpy = vi.spyOn(window.history, "replaceState");

		const config: ProviderConfig = { storage: "sessionStorage" } as any;
		const result = await exchangeTokenByAuthCode("authCode", "validState", config);

		expect(result).toEqual({
			accessTokenStorage: {
				accessToken: "access123",
				expiresIn: 3600,
				expiresOn: "expiryTime",
			},
			refreshTokenStorage: {
				refreshToken: "refresh123",
				expiresIn: 7200,
				expiresOn: "refreshExpiry",
			},
			idTokenStorage: {
				idToken: fakeTokenResult.id_token,
				account: JSON.parse(fakePayload),
			},
		});

		expect(window.sessionStorage.getItem(SessionStorageKey.State)).toBeNull();
		expect(window.sessionStorage.getItem(SessionStorageKey.CodeVerifier)).toBeNull();

		const storedRefreshToken = window.sessionStorage.getItem(StorageKey.RefreshToken);
		expect(storedRefreshToken).toBe(
			JSON.stringify({
				refreshToken: "refresh123",
				expiresIn: 7200,
				expiresOn: "refreshExpiry",
			}),
		);

		const storedIdToken = window.sessionStorage.getItem(StorageKey.IdToken);
		expect(storedIdToken).toBe(
			JSON.stringify({
				idToken: fakeTokenResult.id_token,
				account: JSON.parse(fakePayload),
			}),
		);

		expect(mockedPostTokenByAuthCode).toHaveBeenCalledWith(config, {
			code: "authCode",
			codeVerifier: "verifierValue",
		});

		expect(replaceStateSpy).toHaveBeenCalled();
		const newUrl = new URL(window.location.href);
		expect(newUrl.search).toBe("");
	});

	it("should exchange token successfully without refresh_token and id_token", async () => {
		window.history.pushState({}, "Test Title", "/?code=authcode&state=validState");
		window.sessionStorage.setItem(SessionStorageKey.State, "validState");
		window.sessionStorage.setItem(SessionStorageKey.CodeVerifier, "verifierValue");

		const fakeTokenResult = {
			access_token: "access123",
			expires_in: 3600,
			expires_on: "expiryTime",
		};

		mockedPostTokenByAuthCode.mockResolvedValueOnce(fakeTokenResult);
		const config: ProviderConfig = { storage: "sessionStorage" } as any;
		const result = await exchangeTokenByAuthCode("authCode", "validState", config);

		expect(result).toEqual({
			accessTokenStorage: {
				accessToken: "access123",
				expiresIn: 3600,
				expiresOn: "expiryTime",
			},
			refreshTokenStorage: null,
			idTokenStorage: null,
		});

		expect(window.sessionStorage.getItem(SessionStorageKey.State)).toBeNull();
		expect(window.sessionStorage.getItem(SessionStorageKey.CodeVerifier)).toBeNull();

		expect(window.sessionStorage.getItem(StorageKey.RefreshToken)).toBeNull();
		expect(window.sessionStorage.getItem(StorageKey.IdToken)).toBeNull();
	});

	it("should decode id_token payload correctly with missing padding and url-safe encoding", async () => {
		window.history.pushState({}, "Test Title", "/?code=authcode&state=validState");
		window.sessionStorage.setItem(SessionStorageKey.State, "validState");
		window.sessionStorage.setItem(SessionStorageKey.CodeVerifier, "verifierValue");

		const payloadObj = identityClaims({ foo: "bar", num: 42 });
		const payloadStr = JSON.stringify(payloadObj);
		const base64Encoded = btoa(payloadStr);
		const urlSafeB64 = base64Encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

		const fakeTokenResult = {
			access_token: "access123",
			expires_in: 3600,
			expires_on: "expiryTime",
			id_token: `header.${urlSafeB64}.signature`,
		};

		mockedPostTokenByAuthCode.mockResolvedValueOnce(fakeTokenResult);

		const config: ProviderConfig = { storage: "sessionStorage" } as any;
		const result = await exchangeTokenByAuthCode("authCode", "validState", config);

		expect(result?.idTokenStorage?.idToken).toEqual(fakeTokenResult.id_token);
		expect(result?.idTokenStorage?.account).toEqual(payloadObj);
	});

	it("should throw error when postTokenByAuthCode fails", async () => {
		window.history.pushState({}, "Test Title", "/?code=errorCode&state=errorState");
		window.sessionStorage.setItem(SessionStorageKey.State, "errorState");
		window.sessionStorage.setItem(SessionStorageKey.CodeVerifier, "errorVerifier");

		const errorMessage = "Network error";
		mockedPostTokenByAuthCode.mockRejectedValueOnce(new Error(errorMessage));

		const config: ProviderConfig = { storage: "sessionStorage" } as any;

		await expect(exchangeTokenByAuthCode("errorCode", "errorState", config)).rejects.toThrow(
			`Failed to exchange token by auth code: Error: ${errorMessage}`,
		);
	});

	it("should store tokens in localStorage when config.storage is not sessionStorage", async () => {
		window.history.pushState({}, "Test Title", "/?code=localCode&state=validLocalState");
		window.sessionStorage.setItem(SessionStorageKey.State, "validLocalState");
		window.sessionStorage.setItem(SessionStorageKey.CodeVerifier, "localVerifier");

		const payloadObj = identityClaims({ local: "value" });
		const payloadStr = JSON.stringify(payloadObj);
		const encodedPayload = btoa(payloadStr);

		const fakeTokenResult = {
			access_token: "accessLocal",
			expires_in: 3600,
			expires_on: "expireLocal",
			refresh_token: "refreshLocal",
			refresh_token_expires_in: 7200,
			refresh_token_expires_on: "refreshExpireLocal",
			id_token: `header.${encodedPayload}.signature`,
		};

		mockedPostTokenByAuthCode.mockResolvedValueOnce(fakeTokenResult);

		const config: ProviderConfig = { storage: "localStorage" } as any;
		const result = await exchangeTokenByAuthCode("localCode", "validLocalState", config);

		expect(result).toEqual({
			accessTokenStorage: {
				accessToken: "accessLocal",
				expiresIn: 3600,
				expiresOn: "expireLocal",
			},
			refreshTokenStorage: {
				refreshToken: "refreshLocal",
				expiresIn: 7200,
				expiresOn: "refreshExpireLocal",
			},
			idTokenStorage: {
				idToken: fakeTokenResult.id_token,
				account: payloadObj,
			},
		});

		expect(window.localStorage.getItem(StorageKey.RefreshToken)).toBe(
			JSON.stringify({
				refreshToken: "refreshLocal",
				expiresIn: 7200,
				expiresOn: "refreshExpireLocal",
			}),
		);
		expect(window.localStorage.getItem(StorageKey.IdToken)).toBe(
			JSON.stringify({
				idToken: fakeTokenResult.id_token,
				account: payloadObj,
			}),
		);

		expect(window.sessionStorage.getItem(StorageKey.RefreshToken)).toBeNull();
		expect(window.sessionStorage.getItem(StorageKey.IdToken)).toBeNull();
	});
});

describe("loadCodeAndStateFromUrl", () => {
	it("should return empty code and state if they are not present in the URL", () => {
		window.history.pushState({}, "Test Title", "/?foo=bar");
		const result = loadCodeAndStateFromUrl();
		expect(result).toEqual({
			code: "",
			state: "",
		});
	});

	it("should return the correct code and state from the URL", () => {
		window.history.pushState({}, "Test Title", "/?code=auth123&state=state456");
		const result = loadCodeAndStateFromUrl();
		expect(result).toEqual({
			code: "auth123",
			state: "state456",
		});
	});

	it("should return empty code and state if only one parameter exists", () => {
		window.history.pushState({}, "Test Title", "/?code=onlyCode");
		const result = loadCodeAndStateFromUrl();
		expect(result).toEqual({
			code: "",
			state: "",
		});
	});
});
