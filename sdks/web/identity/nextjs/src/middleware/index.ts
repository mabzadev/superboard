import { StorageKey, isValidTokens } from "@melody-auth/shared";
import { jwtVerify, importSPKI, importX509, importJWK } from "jose";
import type { JWTPayload, JWK, KeyLike } from "jose";
import { NextRequest, NextResponse } from "next/server";

import { CookieStorage } from "../storage/cookieAdapter";
import { readAccessTokenStorage, readIdTokenStorage, isRecord } from "../validation.js";

export interface MelodyAuthMiddlewareConfig {
	publicKey?: string;
	jwksUri?: string;
	publicPaths?: string[];
	redirectPath?: string;
	cookieOptions?: {
		httpOnly?: boolean;
		secure?: boolean;
		sameSite?: "lax" | "strict" | "none";
		path?: string;
		domain?: string;
	};
}

export interface AuthenticatedRequest extends NextRequest {
	auth?: {
		userId: string;
		account: JWTPayload;
		accessToken: string;
	};
}

let cachedPublicKey: KeyLike | Uint8Array | null = null;
let jwksCache: { keys: JWK[]; timestamp: number } | null = null;
const JWKS_CACHE_DURATION = 24 * 60 * 60 * 1000;

async function importJWKKey(jwk: JWK): Promise<KeyLike | Uint8Array> {
	if (jwk.n && jwk.e) {
		const key = await importJWK(jwk, "RS256");
		return key;
	}

	if (jwk.x5c && jwk.x5c[0]) {
		const certPEM = `-----BEGIN CERTIFICATE-----\n${jwk.x5c[0]}\n-----END CERTIFICATE-----`;
		const key = await importX509(certPEM, "RS256");
		return key;
	}

	throw new Error("JWK key format not supported - missing n/e or x5c");
}

async function getPublicKey(config: MelodyAuthMiddlewareConfig): Promise<KeyLike | Uint8Array> {
	if (cachedPublicKey) return cachedPublicKey;

	if (config.publicKey) {
		const spki = await importSPKI(config.publicKey, "RS256");
		cachedPublicKey = spki;
		return spki;
	}

	if (config.jwksUri) {
		if (jwksCache && Date.now() - jwksCache.timestamp < JWKS_CACHE_DURATION) {
			const rsaKey = jwksCache.keys.find((key) => key.kty === "RSA" && key.use === "sig");
			if (rsaKey) {
				return await importJWKKey(rsaKey);
			}
		}

		try {
			const response = await fetch(config.jwksUri);
			if (!response.ok) {
				throw new Error(`Failed to fetch JWKS: ${response.statusText}`);
			}

			const jwks: unknown = await response.json();
			if (!isRecord(jwks) || !Array.isArray(jwks.keys)) throw new Error("Invalid JWKS response");
			const keys = jwks.keys.filter(isSigningJwk);
			jwksCache = {
				keys,
				timestamp: Date.now(),
			};

			const rsaKey = keys.find((key) => key.kty === "RSA" && key.use === "sig");
			if (!rsaKey) {
				throw new Error("No RSA signing key found in JWKS");
			}

			cachedPublicKey = await importJWKKey(rsaKey);
			return cachedPublicKey;
		} catch (error) {
			throw new Error(
				`Failed to fetch or parse JWKS: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	throw new Error("Either publicKey or jwksUri must be provided");
}

export function createMelodyAuthMiddleware(config: MelodyAuthMiddlewareConfig) {
	return async function middleware(request: NextRequest) {
		const pathname = request.nextUrl.pathname;

		if (config.publicPaths?.some((path) => pathname.startsWith(path))) {
			return NextResponse.next();
		}

		const storage = new CookieStorage({
			request,
			...config.cookieOptions,
		});

		try {
			const idTokenStr = storage.getItem(StorageKey.IdToken);
			const accessTokenStr = storage.getItem(StorageKey.AccessToken);

			if (!accessTokenStr) {
				return redirectToLogin(request, config.redirectPath);
			}

			const idTokenStorage = readIdTokenStorage(idTokenStr);
			const accessTokenStorage = readAccessTokenStorage(accessTokenStr);
			if (idTokenStr && !idTokenStorage) return redirectToLogin(request, config.redirectPath);

			const { hasValidIdToken, hasValidAccessToken } = isValidTokens(
				accessTokenStorage,
				null,
				idTokenStorage,
			);

			if (!hasValidAccessToken || !accessTokenStorage) {
				return redirectToLogin(request, config.redirectPath);
			}

			if (idTokenStorage && !hasValidIdToken) {
				return redirectToLogin(request, config.redirectPath);
			}

			let userId: string | undefined;
			let account: JWTPayload | undefined;

			if (idTokenStorage && (config.publicKey || config.jwksUri)) {
				const publicKey = await getPublicKey(config);
				const { payload } = await jwtVerify(idTokenStorage.idToken, publicKey);
				userId = payload.sub;
				account = payload;
			} else if (idTokenStorage) {
				userId = idTokenStorage.account.sub;
				account = { ...idTokenStorage.account };
			}

			const response = NextResponse.next();

			if (userId && account) {
				response.headers.set("x-auth-user-id", userId);
				response.headers.set("x-auth-account", JSON.stringify(account));
			}

			response.headers.set("x-auth-access-token", accessTokenStorage.accessToken);

			return response;
		} catch (error) {
			if (typeof console !== "undefined" && console.error) {
				console.error("Auth middleware error:", error);
			}
			return redirectToLogin(request, config.redirectPath);
		}
	};
}

function redirectToLogin(request: NextRequest, redirectPath = "/login") {
	const url = request.nextUrl.clone();
	url.pathname = redirectPath;
	url.searchParams.set("returnUrl", request.nextUrl.pathname);
	return NextResponse.redirect(url);
}

export function withAuth(
	middleware: (request: AuthenticatedRequest) => NextResponse | Promise<NextResponse>,
	config: MelodyAuthMiddlewareConfig,
) {
	const authMiddleware = createMelodyAuthMiddleware(config);

	return async function wrappedMiddleware(request: NextRequest) {
		const authResponse = await authMiddleware(request);

		if (authResponse.status === 307) {
			return authResponse;
		}

		const userId = authResponse.headers.get("x-auth-user-id");
		const accountStr = authResponse.headers.get("x-auth-account");
		const accessToken = authResponse.headers.get("x-auth-access-token");

		if (accessToken) {
			const authenticatedRequest = request as AuthenticatedRequest;
			authenticatedRequest.auth = {
				userId: userId || "unknown",
				account: readAccount(accountStr),
				accessToken,
			};

			return middleware(authenticatedRequest);
		}

		return authResponse;
	};
}

function isSigningJwk(value: unknown): value is JWK {
	return (
		isRecord(value) &&
		value.kty === "RSA" &&
		value.use === "sig" &&
		["alg", "kid", "n", "e", "d", "p", "q", "dp", "dq", "qi", "x5t", "x5t#S256"].every(
			(key) => value[key] === undefined || typeof value[key] === "string",
		) &&
		(value.x5c === undefined ||
			(Array.isArray(value.x5c) && value.x5c.every((item) => typeof item === "string"))) &&
		(value.key_ops === undefined ||
			(Array.isArray(value.key_ops) && value.key_ops.every((item) => typeof item === "string")))
	);
}
function readAccount(raw: string | null): JWTPayload {
	if (!raw) return {};
	const value: unknown = JSON.parse(raw);
	if (!isRecord(value)) throw new Error("Invalid account payload");
	if (
		!["iss", "sub", "jti"].every(
			(key) => value[key] === undefined || typeof value[key] === "string",
		) ||
		!["exp", "iat", "nbf"].every(
			(key) => value[key] === undefined || typeof value[key] === "number",
		)
	)
		throw new Error("Invalid account payload");
	const aud = value.aud;
	if (
		aud !== undefined &&
		typeof aud !== "string" &&
		!(Array.isArray(aud) && aud.every((entry) => typeof entry === "string"))
	)
		throw new Error("Invalid account audience");
	return {
		...value,
		iss: typeof value.iss === "string" ? value.iss : undefined,
		sub: typeof value.sub === "string" ? value.sub : undefined,
		jti: typeof value.jti === "string" ? value.jti : undefined,
		exp: typeof value.exp === "number" ? value.exp : undefined,
		iat: typeof value.iat === "number" ? value.iat : undefined,
		nbf: typeof value.nbf === "number" ? value.nbf : undefined,
		aud,
	};
}
