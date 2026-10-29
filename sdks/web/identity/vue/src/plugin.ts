import {
	ProviderConfig,
	getParams,
	handleError,
	ErrorType,
	checkStorage,
	loadRefreshTokenStorageFromParams,
	isValidTokens,
} from "@melody-auth/shared";
import { loadCodeAndStateFromUrl } from "@melody-auth/web";
import { App, reactive } from "vue";

import { AuthState, melodyAuthInjectionKey } from "./context";
import { acquireToken, handleTokenExchangeByAuthCode } from "./utils";
import { readRefreshTokenStorage, readIdTokenStorage } from "./validation.js";

export const AuthProvider = {
	install(app: App, config: ProviderConfig) {
		const state = reactive<AuthState>({
			isAuthenticating: true,
			authenticationError: "",
			isAuthenticated: false,
			config,
			userInfo: null,
			idToken: null,
			account: null,
			accessTokenStorage: null,
			refreshTokenStorage: null,
			checkedStorage: false,
			isLoadingUserInfo: false,
			acquireUserInfoError: "",
			isLoadingToken: false,
			acquireTokenError: "",
			loginError: "",
			logoutError: "",
		});

		const initialWithStorage = () => {
			if (typeof window === "undefined") return;

			let parsedRefreshToken = loadRefreshTokenStorageFromParams(config.storage);

			const { storedRefreshToken, storedIdToken } = checkStorage(config.storage);

			if (!parsedRefreshToken && storedRefreshToken) {
				parsedRefreshToken = readRefreshTokenStorage(storedRefreshToken);
			}

			const parsedIdToken = readIdTokenStorage(storedIdToken);

			if (parsedRefreshToken || parsedIdToken) {
				const { hasValidIdToken, hasValidRefreshToken } = isValidTokens(
					null,
					parsedRefreshToken,
					parsedIdToken,
				);
				const account = parsedIdToken?.account;

				if (hasValidRefreshToken || !!account) {
					state.refreshTokenStorage = hasValidRefreshToken ? parsedRefreshToken : null;
					state.account = account ?? null;
					state.idToken = hasValidIdToken && parsedIdToken ? parsedIdToken.idToken : null;
					state.checkedStorage = true;
					return;
				}
			}
			state.checkedStorage = true;
		};

		initialWithStorage();

		app.provide(melodyAuthInjectionKey, state);

		app.mixin({
			mounted() {
				const params = getParams();
				const containCode = "code" in params && !!params.code;

				if (state.accessTokenStorage) return;

				if (!containCode && state.refreshTokenStorage && !state.accessTokenStorage) {
					acquireToken(state).catch((error: unknown) => {
						state.acquireTokenError = handleError(error, ErrorType.ExchangeAccessToken);
					});
					return;
				}

				if (!state.authenticationError && (containCode || state.checkedStorage)) {
					const { code, state: requestState } = loadCodeAndStateFromUrl();

					handleTokenExchangeByAuthCode(
						code,
						requestState,
						state,
						"locale" in params ? params.locale : undefined,
					);
				}
			},
		});
	},
};
