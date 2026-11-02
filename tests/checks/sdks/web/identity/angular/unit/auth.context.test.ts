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
import {
	getParams,
	checkStorage,
	loadRefreshTokenStorageFromParams,
	isValidTokens,
} from "@melody-auth/shared";
import { loadCodeAndStateFromUrl } from "@melody-auth/web";
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";

import { AuthContext } from "../../../../../../../sdks/web/identity/angular/src/auth.context";
import {
	acquireToken,
	handleTokenExchangeByAuthCode,
} from "../../../../../../../sdks/web/identity/angular/src/utils";
import { identityClaims } from "../../../../../../fixtures/identity/claims.js";

vi.mock("@melody-auth/shared", () => ({
	getParams: vi.fn(),
	checkStorage: vi.fn(),
	isValidTokens: vi.fn(),
	loadRefreshTokenStorageFromParams: vi.fn(),
}));

vi.mock("@melody-auth/web", () => ({ loadCodeAndStateFromUrl: vi.fn() }));

vi.mock("../../../../../../../sdks/web/identity/angular/src/utils", () => ({
	acquireToken: vi.fn(async () => undefined),
	handleTokenExchangeByAuthCode: vi.fn(),
}));

const dummyConfig = { storage: "dummyStorage" };

describe("AuthContext", () => {
	let originalWindow: any;

	beforeEach(() => {
		originalWindow = global.window;
		global.window = {} as any;
		vi.clearAllMocks();
	});

	afterEach(() => {
		global.window = originalWindow;
	});

	it("should initialize state with valid stored token and call acquireToken", () => {
		(checkStorage as Mock).mockReturnValue({
			storedRefreshToken: JSON.stringify({
				refreshToken: "dummy-refresh",
				expiresIn: 3600,
				expiresOn: 4000000000,
			}),
			storedIdToken: JSON.stringify({
				idToken: "dummy-id-token",
				account: identityClaims({ id: "dummy-account" }),
			}),
		});
		(isValidTokens as Mock).mockReturnValue({
			hasValidIdToken: false,
			hasValidRefreshToken: true,
			hasValidAccessToken: true,
		});
		(getParams as Mock).mockReturnValue({});

		const acquireTokenMock = acquireToken as Mock;
		const handleTokenExchangeByAuthCodeMock = handleTokenExchangeByAuthCode as Mock;

		const authContext = new AuthContext(dummyConfig);

		const stateValue = authContext.state();
		expect(stateValue.config).toEqual(dummyConfig);
		expect(stateValue.refreshTokenStorage).toEqual({
			refreshToken: "dummy-refresh",
			expiresIn: 3600,
			expiresOn: 4000000000,
		});
		expect(stateValue.account).toStrictEqual(identityClaims({ id: "dummy-account" }));
		expect(stateValue.checkedStorage).toBe(true);

		expect(acquireTokenMock).toHaveBeenCalledTimes(1);
		expect(handleTokenExchangeByAuthCodeMock).not.toHaveBeenCalled();
	});

	it("should initialize state with valid stored token and null stored account and call acquireToken", () => {
		(checkStorage as Mock).mockReturnValue({
			storedRefreshToken: JSON.stringify({
				refreshToken: "dummy-refresh-null-account",
				expiresIn: 3600,
				expiresOn: 4000000000,
			}),
			storedAccount: null,
		});
		(isValidTokens as Mock).mockReturnValue({
			hasValidIdToken: false,
			hasValidRefreshToken: true,
			hasValidAccessToken: true,
		});
		(getParams as Mock).mockReturnValue({});

		const acquireTokenMock = acquireToken as Mock;
		const handleTokenExchangeByAuthCodeMock = handleTokenExchangeByAuthCode as Mock;

		const authContext = new AuthContext(dummyConfig);
		const stateValue = authContext.state();

		expect(stateValue.config).toEqual(dummyConfig);
		expect(stateValue.refreshTokenStorage).toEqual({
			refreshToken: "dummy-refresh-null-account",
			expiresIn: 3600,
			expiresOn: 4000000000,
		});
		expect(stateValue.account).toBeNull();
		expect(stateValue.checkedStorage).toBe(true);

		expect(acquireTokenMock).toHaveBeenCalledTimes(1);
		expect(handleTokenExchangeByAuthCodeMock).not.toHaveBeenCalled();
	});

	it("should initialize state with no stored token and call handleTokenExchangeByAuthCode", () => {
		(checkStorage as Mock).mockReturnValue({
			storedRefreshToken: null,
			storedAccount: null,
		});
		(getParams as Mock).mockReturnValue({});
		(loadCodeAndStateFromUrl as Mock).mockReturnValue({
			code: "dummy-code",
			state: "dummy-requestState",
		});

		const acquireTokenMock = acquireToken as Mock;
		const handleTokenExchangeByAuthCodeMock = handleTokenExchangeByAuthCode as Mock;

		const authContext = new AuthContext(dummyConfig);
		const stateValue = authContext.state();
		expect(stateValue.checkedStorage).toBe(true);

		expect(handleTokenExchangeByAuthCodeMock).toHaveBeenCalledTimes(1);
		expect(handleTokenExchangeByAuthCodeMock).toHaveBeenCalledWith(
			"dummy-code",
			"dummy-requestState",
			authContext.state,
			undefined,
		);
		expect(acquireTokenMock).not.toHaveBeenCalled();
	});

	it("should not call token functions if accessTokenStorage already exists", () => {
		(getParams as Mock).mockReturnValue({ code: "dummy-code" });
		const authContext = new AuthContext(dummyConfig);
		vi.clearAllMocks();
		authContext.state.update((prev: any) => ({
			...prev,
			accessTokenStorage: { accessToken: "existing-token" },
		}));
		(authContext as any).onMounted();
		expect(acquireToken).not.toHaveBeenCalled();
		expect(handleTokenExchangeByAuthCode).not.toHaveBeenCalled();
	});

	it("should not call handleTokenExchangeByAuthCode if authenticationError is present even if containsCode is true", () => {
		(getParams as Mock).mockReturnValue({
			code: "dummy-code",
			locale: "en",
		});
		(loadCodeAndStateFromUrl as Mock).mockReturnValue({
			code: "dummy-code-from-url",
			state: "dummy-requestState",
		});
		const authContext = new AuthContext(dummyConfig);
		authContext.state.update((prev: any) => ({
			...prev,
			authenticationError: "error occurred",
			checkedStorage: true,
		}));
		vi.clearAllMocks();
		(authContext as any).onMounted();
		expect(handleTokenExchangeByAuthCode).not.toHaveBeenCalled();
		expect(acquireToken).not.toHaveBeenCalled();
	});

	it("should initialize state using loadRefreshTokenStorageFromParams when it returns a value", () => {
		global.window = {} as any;
		(loadRefreshTokenStorageFromParams as Mock).mockReturnValue({
			token: "dummy-token-from-params",
		});
		(checkStorage as Mock).mockReturnValue({
			storedRefreshToken: JSON.stringify({
				refreshToken: "dummy-refresh",
				expiresIn: 3600,
				expiresOn: 4000000000,
			}),
		});
		(isValidTokens as Mock).mockReturnValue({
			hasValidIdToken: false,
			hasValidRefreshToken: true,
			hasValidAccessToken: true,
		});
		(getParams as Mock).mockReturnValue({});

		const authContext = new AuthContext(dummyConfig);
		const stateValue = authContext.state();

		expect(stateValue.refreshTokenStorage).toEqual({ token: "dummy-token-from-params" });
		expect(stateValue.account).toBeNull();
		expect(stateValue.checkedStorage).toBe(true);
	});

	it("should return early from initialWithStorage if window is undefined", () => {
		global.window = undefined;
		const mockedCheckStorage = checkStorage as any;
		mockedCheckStorage.mockClear();

		const authContext = new AuthContext(dummyConfig);
		const stateValue = authContext.state();
		expect(stateValue.config).toEqual(dummyConfig);
		expect(stateValue.refreshTokenStorage).toBeNull();
		expect(stateValue.checkedStorage).toBe(false);

		expect(mockedCheckStorage).not.toHaveBeenCalled();
	});
});
