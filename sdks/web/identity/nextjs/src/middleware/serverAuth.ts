import { StorageKey, isValidTokens, AccessTokenStorage } from "@melody-auth/shared";
import { exchangeTokenByRefreshToken } from "@melody-auth/web";

import { CookieStorage } from "../storage/cookieAdapter";
import {
	readAccessTokenStorage,
	readIdTokenStorage,
	readRefreshTokenStorage,
} from "../validation.js";

export interface ServerAuthOptions {
	clientId: string;
	serverUrl: string;
	redirectUri: string;
	cookieOptions?: {
		httpOnly?: boolean;
		secure?: boolean;
		sameSite?: "lax" | "strict" | "none";
		path?: string;
		domain?: string;
	};
}

export interface AuthSession {
	userId?: string;
	email?: string;
	account?: any;
	accessToken: string;
	idToken?: string;
	isAuthenticated: boolean;
}

export async function getServerSession(options: ServerAuthOptions): Promise<AuthSession | null> {
	const storage = new CookieStorage({ ...options.cookieOptions });

	try {
		const idTokenStr = await storage.getItemAsync(StorageKey.IdToken);
		const accessTokenStr = await storage.getItemAsync(StorageKey.AccessToken);
		const refreshTokenStr = await storage.getItemAsync(StorageKey.RefreshToken);

		if (!accessTokenStr) {
			return null;
		}

		const idTokenStorage = readIdTokenStorage(idTokenStr);
		const accessTokenStorage = readAccessTokenStorage(accessTokenStr);
		if (idTokenStr && !idTokenStorage) return null;
		const refreshTokenStorage = readRefreshTokenStorage(refreshTokenStr);

		const { hasValidIdToken, hasValidAccessToken, hasValidRefreshToken } = isValidTokens(
			accessTokenStorage,
			refreshTokenStorage,
			idTokenStorage,
		);

		if (!hasValidAccessToken && hasValidRefreshToken && refreshTokenStorage) {
			try {
				const newTokens = await exchangeTokenByRefreshToken(
					{
						clientId: options.clientId,
						serverUri: options.serverUrl,
						redirectUri: options.redirectUri,
					},
					refreshTokenStorage.refreshToken,
				);

				const newAccessTokenStorage: AccessTokenStorage = {
					accessToken: newTokens.accessToken,
					expiresIn: newTokens.expiresIn,
					expiresOn: newTokens.expiresOn,
				};

				await storage.setItemAsync(StorageKey.AccessToken, JSON.stringify(newAccessTokenStorage));

				return {
					userId: idTokenStorage?.account.sub,
					email: idTokenStorage?.account.email ?? undefined,
					account: idTokenStorage?.account,
					accessToken: newTokens.accessToken,
					idToken: idTokenStorage?.idToken,
					isAuthenticated: true,
				};
			} catch (error) {
				console.error("Failed to refresh token:", error);
				return null;
			}
		}

		if (!hasValidAccessToken || !accessTokenStorage) {
			return null;
		}

		if (idTokenStorage && !hasValidIdToken) {
			return null;
		}

		return {
			userId: idTokenStorage?.account.sub,
			email: idTokenStorage?.account.email ?? undefined,
			account: idTokenStorage?.account,
			accessToken: accessTokenStorage.accessToken,
			idToken: idTokenStorage?.idToken,
			isAuthenticated: true,
		};
	} catch (error) {
		console.error("Error getting server session:", error);
		return null;
	}
}

export async function requireAuth(
	options: ServerAuthOptions,
	redirectTo = "/login",
): Promise<AuthSession> {
	const session = await getServerSession(options);

	if (!session) {
		throw new Error(`Unauthorized: Please login at ${redirectTo}`);
	}

	return session;
}
