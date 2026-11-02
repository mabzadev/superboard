import { exchangeTokenByAuthCode, loadCodeAndStateFromUrl } from "@melody-auth/web";
import { render, waitFor } from "@testing-library/react";
import * as React from "react";
import { vi, describe, it, expect, beforeEach } from "vitest";

import authContext from "../../../../../../../sdks/web/identity/react/src/context";
import Setup from "../../../../../../../sdks/web/identity/react/src/Setup";

if (typeof window.history.pushState !== "function") {
	window.history.pushState = (state: any, title: string, url?: string) => {
		if (url) {
			const newUrl = new URL(url, window.location.origin);
			Object.defineProperty(window, "location", {
				configurable: true,
				writable: true,
				value: newUrl,
			});
		}
	};
}

const mockAcquireToken = vi.fn(async () => undefined);
vi.mock("../../../../../../../sdks/web/identity/react/src/useAuth", () => {
	return { useAuth: () => ({ acquireToken: mockAcquireToken }) };
});

vi.mock("@melody-auth/web", () => ({
	exchangeTokenByAuthCode: vi.fn(),
	loadCodeAndStateFromUrl: vi.fn(() => {
		const params = new URLSearchParams(window.location.search);
		return {
			code: params.get("code") || "",
			state: params.get("state") || "",
		};
	}),
}));

describe("Setup Component", () => {
	let dispatch: ReturnType<typeof vi.fn>;
	let defaultState: any;

	beforeEach(() => {
		dispatch = vi.fn();
		mockAcquireToken.mockReset();
		exchangeTokenByAuthCode.mockReset();

		defaultState = {
			checkedStorage: false,
			accessTokenStorage: null,
			refreshTokenStorage: null,
			config: { onLoginSuccess: vi.fn() },
		};
		window.history.pushState({}, "Test Title", "/");
	});

	it("should do nothing if accessTokenStorage exists", async () => {
		const state = {
			...defaultState,
			accessTokenStorage: "existingAccessToken",
		};
		const contextValue = {
			state,
			dispatch,
		};

		render(
			<authContext.Provider value={contextValue}>
				<Setup />
			</authContext.Provider>,
		);

		await waitFor(() => {
			expect(mockAcquireToken).not.toHaveBeenCalled();
			expect(exchangeTokenByAuthCode).not.toHaveBeenCalled();
		});
	});

	it("should call acquireToken if no code in URL and refreshTokenStorage exists", async () => {
		const state = {
			...defaultState,
			refreshTokenStorage: "existingRefreshToken",
		};
		const contextValue = {
			state,
			dispatch,
		};
		window.history.pushState({}, "Test Title", "/?someParam=value");

		render(
			<authContext.Provider value={contextValue}>
				<Setup />
			</authContext.Provider>,
		);

		await waitFor(() => {
			expect(mockAcquireToken).toHaveBeenCalled();
			expect(exchangeTokenByAuthCode).not.toHaveBeenCalled();
		});
	});

	it("should call exchangeTokenByAuthCode and dispatch actions on success when code is present", async () => {
		window.history.pushState({}, "Test Title", "/?code=sampleCode&state=xyz&locale=en");
		const onLoginSuccess = vi.fn();
		const state = {
			...defaultState,
			config: { onLoginSuccess },
		};
		const contextValue = {
			state,
			dispatch,
		};

		const mockResponse = {
			accessTokenStorage: "newAccessToken",
			refreshTokenStorage: "newRefreshToken",
			idTokenStorage: {
				idToken: "header.eyJzdWIiOiIxMjM0NSJ9.signature",
				account: { sub: "user123" },
			},
		};
		exchangeTokenByAuthCode.mockResolvedValueOnce(mockResponse);

		render(
			<authContext.Provider value={contextValue}>
				<Setup />
			</authContext.Provider>,
		);

		await waitFor(() => {
			expect(exchangeTokenByAuthCode).toHaveBeenCalledWith("sampleCode", "xyz", state.config);
		});

		await waitFor(() => {
			expect(dispatch).toHaveBeenCalledWith({
				type: "setAccessTokenStorage",
				payload: "newAccessToken",
			});
			expect(dispatch).toHaveBeenCalledWith({
				type: "setAuth",
				payload: {
					refreshTokenStorage: "newRefreshToken",
					idTokenBody: { sub: "user123" },
					idToken: "header.eyJzdWIiOiIxMjM0NSJ9.signature",
				},
			});
			expect(onLoginSuccess).toHaveBeenCalledWith({
				state: "xyz",
				locale: "en",
			});
		});
	});

	it("should dispatch setIsAuthenticating if exchangeTokenByAuthCode returns without accessTokenStorage", async () => {
		window.history.pushState({}, "Test Title", "/?code=sampleCode");
		const state = {
			...defaultState,
			config: {},
		};
		const contextValue = {
			state,
			dispatch,
		};

		const mockResponse = {
			refreshTokenStorage: "newRefreshToken",
			idTokenStorage: {
				idToken: "header.eyJzdWIiOiIxMjM0NSJ9.signature",
				account: { sub: "user456" },
			},
		};
		exchangeTokenByAuthCode.mockResolvedValueOnce(mockResponse);

		render(
			<authContext.Provider value={contextValue}>
				<Setup />
			</authContext.Provider>,
		);

		await waitFor(() => {
			expect(exchangeTokenByAuthCode).toHaveBeenCalledWith("sampleCode", "", state.config);
		});

		await waitFor(() => {
			expect(dispatch).toHaveBeenCalledWith({
				type: "setIsAuthenticating",
				payload: false,
			});
			expect(dispatch).toHaveBeenCalledWith({
				type: "setAuth",
				payload: {
					refreshTokenStorage: "newRefreshToken",
					idTokenBody: { sub: "user456" },
					idToken: "header.eyJzdWIiOiIxMjM0NSJ9.signature",
				},
			});
		});
	});

	it("should dispatch authentication error if exchangeTokenByAuthCode fails", async () => {
		window.history.pushState({}, "Test Title", "/?code=sampleCode&state=xyz");
		(loadCodeAndStateFromUrl as vi.Mock).mockReturnValueOnce({
			code: "sampleCode",
			state: "xyz",
		});
		const error = new Error("Token exchange failed");

		const state = {
			...defaultState,
			config: {},
		};
		const contextValue = {
			state,
			dispatch,
		};
		exchangeTokenByAuthCode.mockRejectedValueOnce(error);

		render(
			<authContext.Provider value={contextValue}>
				<Setup />
			</authContext.Provider>,
		);

		await waitFor(() => {
			expect(exchangeTokenByAuthCode).toHaveBeenCalledWith("sampleCode", "xyz", state.config);
		});
		await waitFor(() => {
			expect(dispatch).toHaveBeenCalledWith({
				type: "setAuthenticationError",
				payload: "Can not obtain access token",
			});
		});
	});

	it("should do nothing on subsequent effect invocations if already initialized", async () => {
		const initialState = {
			...defaultState,
			checkedStorage: true,
		};
		const contextValue = {
			state: initialState,
			dispatch,
		};

		const dummyResponse = {
			accessTokenStorage: "dummyAccessToken",
			refreshTokenStorage: null,
			idTokenBody: null,
		};
		exchangeTokenByAuthCode.mockResolvedValueOnce(dummyResponse);

		const { rerender } = render(
			<authContext.Provider value={contextValue}>
				<Setup />
			</authContext.Provider>,
		);

		await waitFor(() => {
			expect(exchangeTokenByAuthCode).toHaveBeenCalledTimes(1);
		});

		const newState = {
			...initialState,
			checkedStorage: false,
		};
		const newContextValue = {
			state: newState,
			dispatch,
		};
		rerender(
			<authContext.Provider value={newContextValue}>
				<Setup />
			</authContext.Provider>,
		);

		await waitFor(() => {
			expect(exchangeTokenByAuthCode).toHaveBeenCalledTimes(1);
			expect(mockAcquireToken).not.toHaveBeenCalled();
		});
	});
});
