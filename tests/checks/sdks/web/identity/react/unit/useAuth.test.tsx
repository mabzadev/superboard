import { handleError } from "@melody-auth/shared";
import { triggerLogin, logout, exchangeTokenByRefreshToken, getUserInfo } from "@melody-auth/web";
import { render, act } from "@testing-library/react";
import * as React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";

import authContext from "../../../../../../../sdks/web/identity/react/src/context";
import { useAuth } from "../../../../../../../sdks/web/identity/react/src/useAuth";
import * as utils from "../../../../../../../sdks/web/identity/react/src/utils";

vi.mock("@melody-auth/web", () => ({
	triggerLogin: vi.fn(),
	logout: vi.fn(),
	exchangeTokenByRefreshToken: vi.fn(),
	getUserInfo: vi.fn(),
}));

vi.mock("@melody-auth/shared", async () => {
	const original = await import("@melody-auth/shared");
	return {
		...original,
		handleError: vi.fn(),
	};
});

const HookWrapper = ({
	onRender,
}: {
	onRender: (hookValue: ReturnType<typeof useAuth>) => void;
}) => {
	const auth = useAuth();
	onRender(auth);
	return null;
};

describe("useAuth Hook", () => {
	let defaultState: any;
	let dispatch: any;

	beforeEach(() => {
		dispatch = vi.fn();
		defaultState = {
			accessTokenStorage: null,
			refreshTokenStorage: null,
			isAuthenticated: false,
			isAuthenticating: false,
			config: { clientId: "test-client" },
			userInfo: null,
			account: null,
			isLoadingToken: false,
			isLoadingUserInfo: false,
			authenticationError: null,
			acquireTokenError: null,
			acquireUserInfoError: null,
			loginError: null,
			logoutError: null,
		};
		vi.resetAllMocks();
	});

	const renderHookWithState = (stateOverride = {}): ReturnType<typeof useAuth> => {
		const state = {
			...defaultState,
			...stateOverride,
		};
		let hookValue: ReturnType<typeof useAuth> | undefined;
		render(
			<authContext.Provider
				value={{
					state,
					dispatch,
				}}
			>
				<HookWrapper
					onRender={(value) => {
						hookValue = value;
					}}
				/>
			</authContext.Provider>,
		);
		if (!hookValue) throw new Error("Hook did not render");
		return hookValue;
	};

	it("should return computed accessToken and refreshToken", () => {
		const futureTime = Math.floor(new Date().getTime() / 1000) + 1000;
		const state = {
			accessTokenStorage: {
				accessToken: "access123",
				expiresOn: futureTime,
			},
			refreshTokenStorage: {
				refreshToken: "refresh123",
				expiresOn: futureTime,
			},
		};
		const auth = renderHookWithState(state);
		expect(auth.accessToken).toBe("access123");
		expect(auth.refreshToken).toBe("refresh123");
	});

	it("loginRedirect should throw if isAuthenticating is true", () => {
		const auth = renderHookWithState({ isAuthenticating: true });
		expect(() => auth.loginRedirect()).toThrow("Please wait until isAuthenticating=false");
	});

	it("loginRedirect should throw if already authenticated and policy is sign_in_or_sign_up", () => {
		const auth = renderHookWithState({ isAuthenticated: true });
		expect(() => auth.loginRedirect()).toThrow("Already authenticated, please logout first");
	});

	it("loginRedirect should throw if already authenticated and policy is sign_in_or_sign_up when explicitly provided", () => {
		const auth = renderHookWithState({ isAuthenticated: true });
		expect(() =>
			auth.loginRedirect({
				locale: "en",
				state: "test",
				policy: "sign_in_or_sign_up",
			}),
		).toThrow("Already authenticated, please logout first");
	});

	it("loginRedirect should call triggerLogin with proper config and props", () => {
		const auth = renderHookWithState({
			isAuthenticated: false,
			isAuthenticating: false,
		});
		(triggerLogin as any).mockImplementation(() => {});
		const props = {
			locale: "en",
			state: "test",
			policy: "custom_policy",
			authorizePopupHandler: expect.any(Function),
		};
		auth.loginRedirect(props);
		expect(triggerLogin).toHaveBeenCalledWith("redirect", defaultState.config, props);
	});

	it("loginRedirect should call triggerLogin when already authenticated with a custom policy", () => {
		const auth = renderHookWithState({
			isAuthenticated: true,
			isAuthenticating: false,
		});
		(triggerLogin as any).mockImplementation(() => {});
		const props = {
			locale: "en",
			state: "test",
			policy: "custom_policy",
			authorizePopupHandler: expect.any(Function),
		};
		auth.loginRedirect(props);
		expect(triggerLogin).toHaveBeenCalledWith("redirect", defaultState.config, props);
	});

	it("loginRedirect should dispatch setLoginError when rawLoginRedirect throws", () => {
		(triggerLogin as any).mockImplementation(() => {
			throw new Error("Test error");
		});
		vi.mocked(handleError).mockReturnValue("handled error message");
		const auth = renderHookWithState({
			isAuthenticated: false,
			isAuthenticating: false,
		});

		auth.loginRedirect({ locale: "en" });

		expect(dispatch).toHaveBeenCalledWith({
			type: "setLoginError",
			payload: "handled error message",
		});
	});

	it("acquireToken should return cached token if valid", async () => {
		const futureTime = Math.floor(new Date().getTime() / 1000) + 1000;
		const state = {
			accessTokenStorage: {
				accessToken: "cachedToken",
				expiresOn: futureTime,
			},
		};
		const auth = renderHookWithState(state);
		let token: string = "";
		await act(async () => {
			token = await auth.acquireToken();
		});
		expect(token).toBe("cachedToken");
	});

	it("acquireToken should call exchangeTokenByRefreshToken if refresh token is valid", async () => {
		const currentTime = Math.floor(new Date().getTime() / 1000);
		const state = {
			accessTokenStorage: null,
			refreshTokenStorage: {
				refreshToken: "validRefresh",
				expiresOn: currentTime + 1000,
			},
		};
		const newAccessTokenObj = {
			accessToken: "newAccess",
			expiresOn: currentTime + 1000,
		};
		(exchangeTokenByRefreshToken as any).mockResolvedValue(newAccessTokenObj);
		const auth = renderHookWithState(state);
		let token: string = "";
		await act(async () => {
			token = await auth.acquireToken();
		});
		expect(exchangeTokenByRefreshToken).toHaveBeenCalledWith(defaultState.config, "validRefresh");
		expect(dispatch).toHaveBeenCalledWith({
			type: "setAccessTokenStorage",
			payload: newAccessTokenObj,
		});
		expect(token).toBe("newAccess");
	});

	it("acquireToken should dispatch setAcquireTokenError when exchangeTokenByRefreshToken fails", async () => {
		const currentTime = Math.floor(new Date().getTime() / 1000);
		const state = {
			accessTokenStorage: null,
			refreshTokenStorage: {
				refreshToken: "validRefresh",
				expiresOn: currentTime + 1000,
			},
		};
		vi.mocked(handleError).mockReturnValue("handled acquire token error");
		(exchangeTokenByRefreshToken as any).mockRejectedValue(new Error("Test error"));
		const auth = renderHookWithState(state);
		let token: string = "";
		await act(async () => {
			token = await auth.acquireToken();
		});
		expect(exchangeTokenByRefreshToken).toHaveBeenCalledWith(defaultState.config, "validRefresh");
		expect(dispatch).toHaveBeenCalledWith({
			type: "setAcquireTokenError",
			payload: "handled acquire token error",
		});
		expect(token).toBe("");
	});

	it("acquireUserInfo should return userInfo if already present", async () => {
		const user = { name: "Test User" };
		const state = { userInfo: user };
		const auth = renderHookWithState(state);
		let info: any;
		await act(async () => {
			info = await auth.acquireUserInfo();
		});
		expect(info).toEqual(user);
	});

	it("acquireUserInfo should call getUserInfo if userInfo is not present", async () => {
		const futureTime = Math.floor(new Date().getTime() / 1000) + 1000;
		const state = {
			accessTokenStorage: {
				accessToken: "validToken",
				expiresOn: futureTime,
			},
			userInfo: null,
		};
		const userInfoResponse = { name: "New User" };
		(getUserInfo as any).mockResolvedValue(userInfoResponse);
		const auth = renderHookWithState(state);
		let info: any;
		await act(async () => {
			info = await auth.acquireUserInfo();
		});
		expect(getUserInfo).toHaveBeenCalledWith(defaultState.config, { accessToken: "validToken" });
		expect(dispatch).toHaveBeenCalledWith({
			type: "setUserInfo",
			payload: userInfoResponse,
		});
		expect(info).toEqual(userInfoResponse);
	});

	it("acquireUserInfo should dispatch setAcquireUserInfoError when getUserInfo fails", async () => {
		const futureTime = Math.floor(new Date().getTime() / 1000) + 1000;
		const state = {
			accessTokenStorage: {
				accessToken: "validToken",
				expiresOn: futureTime,
			},
			userInfo: null,
		};
		vi.mocked(handleError).mockReturnValue("handled fetch user info error");
		(getUserInfo as any).mockRejectedValue(new Error("Test error"));
		const auth = renderHookWithState(state);
		let info: any;
		await act(async () => {
			info = await auth.acquireUserInfo();
		});
		expect(getUserInfo).toHaveBeenCalledWith(defaultState.config, { accessToken: "validToken" });
		expect(dispatch).toHaveBeenCalledWith({
			type: "setAcquireUserInfoError",
			payload: "handled fetch user info error",
		});
		expect(info).toBeUndefined();
	});

	it("logoutRedirect should call logout with proper parameters when tokens are valid", async () => {
		const futureTime = Math.floor(new Date().getTime() / 1000) + 1000;
		const state = {
			accessTokenStorage: {
				accessToken: "accessValid",
				expiresOn: futureTime,
			},
			refreshTokenStorage: {
				refreshToken: "refreshValid",
				expiresOn: futureTime,
			},
		};
		const auth = renderHookWithState(state);
		(logout as any).mockResolvedValue(undefined);
		await act(async () => {
			await auth.logoutRedirect({ postLogoutRedirectUri: "https://redirect" });
		});
		expect(logout).toHaveBeenCalledWith(
			defaultState.config,
			"accessValid",
			"refreshValid",
			"https://redirect",
			false,
		);
	});

	it("logoutRedirect should call logout with localOnly true if tokens are missing or localOnly flag is set", async () => {
		const state = {
			accessTokenStorage: null,
			refreshTokenStorage: null,
		};
		const auth = renderHookWithState(state);
		(logout as any).mockResolvedValue(undefined);
		await act(async () => {
			await auth.logoutRedirect({
				postLogoutRedirectUri: "https://redirect",
				localOnly: true,
			});
		});
		expect(logout).toHaveBeenCalledWith(defaultState.config, "", null, "https://redirect", true);
	});

	it("logoutRedirect should dispatch setLogoutError when logout fails", async () => {
		const futureTime = Math.floor(new Date().getTime() / 1000) + 1000;
		const state = {
			accessTokenStorage: {
				accessToken: "accessValid",
				expiresOn: futureTime,
			},
			refreshTokenStorage: {
				refreshToken: "refreshValid",
				expiresOn: futureTime,
			},
		};
		vi.mocked(handleError).mockReturnValue("handled logout error");
		(logout as any).mockRejectedValue(new Error("Test error"));
		const auth = renderHookWithState(state);
		await act(async () => {
			await auth.logoutRedirect({ postLogoutRedirectUri: "https://redirect" });
		});
		expect(logout).toHaveBeenCalledWith(
			defaultState.config,
			"accessValid",
			"refreshValid",
			"https://redirect",
			false,
		);
		expect(dispatch).toHaveBeenCalledWith({
			type: "setLogoutError",
			payload: "handled logout error",
		});
	});

	it("loginPopup should throw if isAuthenticating is true", () => {
		const auth = renderHookWithState({ isAuthenticating: true });
		expect(() => auth.loginPopup()).toThrow("Please wait until isAuthenticating=false");
	});

	it("loginPopup should throw if already authenticated and policy is sign_in_or_sign_up", () => {
		const auth = renderHookWithState({ isAuthenticated: true });
		expect(() => auth.loginPopup()).toThrow("Already authenticated, please logout first");
	});

	it("loginPopup should throw if already authenticated and policy is sign_in_or_sign_up when explicitly provided", () => {
		const auth = renderHookWithState({ isAuthenticated: true });
		expect(() =>
			auth.loginPopup({
				locale: "en",
				state: "test",
			}),
		).toThrow("Already authenticated, please logout first");
	});

	it("loginPopup should call triggerLogin with proper config and props", () => {
		const auth = renderHookWithState({
			isAuthenticated: false,
			isAuthenticating: false,
		});
		(triggerLogin as any).mockImplementation(() => {});
		const props = {
			locale: "en",
			state: "test",
			policy: "custom_policy",
		};
		auth.loginPopup(props);
		expect(triggerLogin).toHaveBeenCalledWith("popup", defaultState.config, {
			...props,
			authorizePopupHandler: expect.any(Function),
		});
	});

	it("loginPopup should dispatch setLoginError when triggerLogin throws", () => {
		(triggerLogin as any).mockImplementation(() => {
			throw new Error("Test error");
		});
		vi.mocked(handleError).mockReturnValue("handled error message");
		const auth = renderHookWithState({
			isAuthenticated: false,
			isAuthenticating: false,
		});
		auth.loginPopup({ locale: "en" });
		expect(dispatch).toHaveBeenCalledWith({
			type: "setLoginError",
			payload: "handled error message",
		});
	});

	it("authorizePopupHandler should call handleTokenExchangeByAuthCode with correct parameters", () => {
		const auth = renderHookWithState({
			isAuthenticated: false,
			isAuthenticating: false,
		});

		let capturedHandler: ((params: { state: string; code: string }) => any) | undefined;
		(triggerLogin as any).mockImplementation((method, config, props) => {
			capturedHandler = props.authorizePopupHandler;
		});

		const props = {
			locale: "en",
			state: "test",
			policy: "custom_policy",
		};
		auth.loginPopup(props);
		expect(capturedHandler).toBeDefined();

		const handleSpy = vi.spyOn(utils, "handleTokenExchangeByAuthCode").mockImplementation(() => {});

		const testPayload = {
			state: "request_state",
			code: "test_code",
		};
		capturedHandler!(testPayload);

		expect(handleSpy).toHaveBeenCalledWith(
			testPayload.code,
			testPayload.state,
			defaultState.config,
			dispatch,
			props.locale,
		);
	});
});
