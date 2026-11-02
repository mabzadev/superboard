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
import * as shared from "@melody-auth/shared";
import * as webModule from "@melody-auth/web";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp } from "vue";

import { melodyAuthInjectionKey } from "../../../../../../../sdks/web/identity/vue/src/context";
import { AuthProvider } from "../../../../../../../sdks/web/identity/vue/src/plugin";
import * as utils from "../../../../../../../sdks/web/identity/vue/src/utils";
import { identityClaims } from "../../../../../../fixtures/identity/claims.js";

vi.mock("@melody-auth/web", () => ({
	loadCodeAndStateFromUrl: vi.fn().mockReturnValue({
		code: "",
		state: "",
	}),
}));

vi.mock("../../../../../../../sdks/web/identity/vue/src/utils", () => ({
	handleTokenExchangeByAuthCode: vi.fn(),
	acquireToken: vi.fn(async () => undefined),
	loadRefreshTokenStorageFromParams: vi.fn().mockReturnValue(null),
}));

vi.mock("@melody-auth/shared", () => ({
	checkStorage: vi.fn().mockReturnValue({
		storedRefreshToken: null,
		storedAccount: null,
		storedIdToken: null,
	}),
	getParams: vi.fn().mockReturnValue({}),
	isValidTokens: vi.fn().mockReturnValue({
		hasValidIdToken: false,
		hasValidRefreshToken: false,
		hasValidAccessToken: false,
	}),
	loadRefreshTokenStorageFromParams: vi.fn().mockReturnValue(null),
}));

describe("AuthProvider Plugin", () => {
	let app;
	let capturedMountedHook;
	const mockConfig = {
		clientId: "test-client-id",
		authority: "https://test-authority.com",
		storage: "localStorage",
	};

	beforeEach(() => {
		app = createApp({ template: "<div>Test App</div>" });

		vi.clearAllMocks();

		shared.checkStorage.mockReturnValue({
			storedRefreshToken: null,
			storedAccount: null,
			storedIdToken: null,
		});
		shared.getParams.mockReturnValue({});
		shared.isValidTokens.mockReturnValue({
			hasValidIdToken: false,
			hasValidRefreshToken: false,
			hasValidAccessToken: false,
		});
		shared.loadRefreshTokenStorageFromParams.mockReturnValue(null);

		global.window = Object.create(window);

		capturedMountedHook = null;
		app.mixin = vi.fn().mockImplementation((mixin) => {
			if (mixin && typeof mixin.mounted === "function") {
				capturedMountedHook = mixin.mounted;
			}
			return app;
		});
	});

	afterEach(() => {
		app = null;
		capturedMountedHook = null;
	});

	it("should install the plugin and provide the auth state", () => {
		let capturedState = null;

		app.provide = (key, value) => {
			if (key === melodyAuthInjectionKey) {
				capturedState = value;
			}
		};

		app.use(AuthProvider, mockConfig);

		expect(capturedState).not.toBeNull();
		expect(capturedState?.config).toEqual(mockConfig);
		expect(capturedState?.isAuthenticating).toBe(true);
		expect(capturedState?.isAuthenticated).toBe(false);
	});

	it("should initialize with storage if valid refresh token exists", () => {
		const mockRefreshToken = JSON.stringify({
			refreshToken: "test-refresh-token",
			expiresIn: 3600,
			expiresOn: Math.floor(Date.now() / 1000) + 3600,
		});

		const mockedIdToken = JSON.stringify({
			idToken: "test-id-token",
			account: identityClaims({ sub: "user-123", name: "Test User", email: "test@example.com" }),
		});

		shared.checkStorage.mockReturnValue({
			storedRefreshToken: mockRefreshToken,
			storedIdToken: mockedIdToken,
		});

		shared.isValidTokens.mockReturnValue({
			hasValidIdToken: true,
			hasValidRefreshToken: true,
			hasValidAccessToken: false,
		});

		let capturedState = null;

		app.provide = (key, value) => {
			if (key === melodyAuthInjectionKey) {
				capturedState = value;
			}
		};

		app.use(AuthProvider, mockConfig);

		expect(shared.checkStorage).toHaveBeenCalledWith(mockConfig.storage);

		expect(capturedState).not.toBeNull();
		expect(capturedState?.refreshTokenStorage).toEqual(JSON.parse(mockRefreshToken));
		expect(capturedState?.account).toStrictEqual(
			identityClaims({ sub: "user-123", name: "Test User", email: "test@example.com" }),
		);
		expect(capturedState?.checkedStorage).toBe(true);
	});

	it("should not initialize with storage if refresh token is invalid", () => {
		const mockRefreshToken = JSON.stringify({
			refreshToken: "test-refresh-token",
			expiresIn: 3600,
			expiresOn: Math.floor(Date.now() / 1000) - 3600,
		});

		shared.checkStorage.mockReturnValue({
			storedRefreshToken: mockRefreshToken,
			storedAccount: null,
		});

		shared.isValidTokens.mockReturnValue({
			hasValidIdToken: false,
			hasValidRefreshToken: false,
			hasValidAccessToken: false,
		});

		let capturedState = null;

		app.provide = (key, value) => {
			if (key === melodyAuthInjectionKey) {
				capturedState = value;
			}
		};

		app.use(AuthProvider, mockConfig);

		expect(shared.checkStorage).toHaveBeenCalledWith(mockConfig.storage);

		expect(capturedState).not.toBeNull();
		expect(capturedState?.refreshTokenStorage).toBeNull();
		expect(capturedState?.account).toBeNull();
		expect(capturedState?.checkedStorage).toBe(true);
	});

	it("should add a mixin with mounted hook", () => {
		app.use(AuthProvider, mockConfig);

		expect(app.mixin).toHaveBeenCalled();
		expect(capturedMountedHook).toBeInstanceOf(Function);
	});

	it("should acquire token if refresh token exists but no access token", async () => {
		let capturedState = null;

		app.provide = (key, value) => {
			if (key === melodyAuthInjectionKey) {
				capturedState = value;
			}
			return app;
		};

		app.use(AuthProvider, mockConfig);

		expect(capturedState).not.toBeNull();
		expect(capturedMountedHook).toBeInstanceOf(Function);

		if (capturedState) {
			capturedState.refreshTokenStorage = { refreshToken: "test-refresh-token" };
			capturedState.accessTokenStorage = null;
			capturedState.checkedStorage = true;
		}

		shared.getParams.mockReturnValue({});

		const componentInstance = {
			$options: {},
			_: { inject: () => capturedState },
		};

		capturedMountedHook.call(componentInstance);

		expect(utils.acquireToken).toHaveBeenCalledWith(capturedState);
	});

	it("should handle token exchange if code is present in URL", async () => {
		let capturedState = null;

		app.provide = (key, value) => {
			if (key === melodyAuthInjectionKey) {
				capturedState = value;
			}
			return app;
		};

		app.use(AuthProvider, mockConfig);

		expect(capturedState).not.toBeNull();
		expect(capturedMountedHook).toBeInstanceOf(Function);

		if (capturedState) {
			capturedState.checkedStorage = true;
			capturedState.accessTokenStorage = null;
		}

		shared.getParams.mockReturnValue({
			code: "test-auth-code",
			locale: "en-US",
		});

		webModule.loadCodeAndStateFromUrl.mockReturnValue({
			code: "test-auth-code",
			state: "test-request-state",
		});

		const componentInstance = {
			$options: {},
			_: { inject: () => capturedState },
		};

		capturedMountedHook.call(componentInstance);

		expect(utils.handleTokenExchangeByAuthCode).toHaveBeenCalledWith(
			"test-auth-code",
			"test-request-state",
			capturedState,
			"en-US",
		);
	});

	it("should not do anything if access token already exists", async () => {
		let capturedState = null;

		app.provide = (key, value) => {
			if (key === melodyAuthInjectionKey) {
				capturedState = value;
			}
			return app;
		};

		app.use(AuthProvider, mockConfig);

		expect(capturedState).not.toBeNull();
		expect(capturedMountedHook).toBeInstanceOf(Function);

		if (capturedState) {
			capturedState.accessTokenStorage = { accessToken: "test-access-token" };
		}

		const componentInstance = {
			$options: {},
			_: { inject: () => capturedState },
		};

		capturedMountedHook.call(componentInstance);

		expect(utils.acquireToken).not.toHaveBeenCalled();
		expect(utils.handleTokenExchangeByAuthCode).not.toHaveBeenCalled();
	});

	it("should handle the case when window is undefined (SSR)", () => {
		global.window = undefined as any;

		app.use(AuthProvider, mockConfig);

		expect(shared.checkStorage).not.toHaveBeenCalled();
	});
});
