import { StorageKey, isValidTokens } from "@melody-auth/shared";
import { jwtVerify, importSPKI, importX509, importJWK } from "jose";
import type { JWTPayload, JWK, KeyLike } from "jose";
import { NextRequest, NextResponse } from "next/server";

import { CookieStorage } from "../storage/cookieAdapter";
import { readAccessTokenStorage, readIdTokenStorage, isRecord } from "../validation.js";

/**
 * Configuration options for the Melody Auth middleware
 */
export interface MelodyAuthMiddlewareConfig {
	/** PEM-encoded RSA public key for JWT verification */
	publicKey?: string;
	/** URI to fetch JWKS (JSON Web Key Set) for JWT verification */
	jwksUri?: string;
	/** Array of path prefixes that don't require authentication */
	publicPaths?: string[];
	/** Path to redirect unauthenticated users (default: '/login') */
	redirectPath?: string;
	/** Cookie configuration options */
	cookieOptions?: {
		httpOnly?: boolean;
		secure?: boolean;
		sameSite?: "lax" | "strict" | "none";
		path?: string;
		domain?: string;
	};
}

/**
 * Extended Next.js request with authentication information
 */
export interface AuthenticatedRequest extends NextRequest {
	/** Authentication information attached to the request */
	auth?: {
		/** User ID from the JWT subject claim */
		userId: string;
		/** Decoded JWT payload containing user account information */
		account: JWTPayload;
		/** Access token for API calls */
		accessToken: string;
	};
}

// Cache for public keys to avoid repeated imports/fetches
let cachedPublicKey: KeyLike | Uint8Array | null = null;
let jwksCache: { keys: JWK[]; timestamp: number } | null = null;
const JWKS_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Imports a JWK key using the appropriate method based on available data
 */
async function importJWKKey(jwk: JWK): Promise<KeyLike | Uint8Array> {
	// First try to import directly as JWK
	if (jwk.n && jwk.e) {
		const key = await importJWK(jwk, "RS256");
		return key;
	}

	// If x5c is available, use X.509 certificate
	if (jwk.x5c && jwk.x5c[0]) {
		// x5c[0] contains the base64-encoded X.509 certificate
		const certPEM = `-----BEGIN CERTIFICATE-----\n${jwk.x5c[0]}\n-----END CERTIFICATE-----`;
		const key = await importX509(certPEM, "RS256");
		return key;
	}

	throw new Error("JWK key format not supported - missing n/e or x5c");
}

/**
 * Retrieves the public key for JWT verification
 * Supports both direct public key configuration and JWKS URI
 * Implements caching to improve performance
 */
async function getPublicKey(config: MelodyAuthMiddlewareConfig): Promise<KeyLike | Uint8Array> {
	if (cachedPublicKey) return cachedPublicKey;

	if (config.publicKey) {
		const spki = await importSPKI(config.publicKey, "RS256");
		cachedPublicKey = spki;
		return spki;
	}

	if (config.jwksUri) {
		// Check cache first
		if (jwksCache && Date.now() - jwksCache.timestamp < JWKS_CACHE_DURATION) {
			const rsaKey = jwksCache.keys.find((key) => key.kty === "RSA" && key.use === "sig");
			if (rsaKey) {
				return await importJWKKey(rsaKey);
			}
		}

		// Fetch JWKS
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

			// Find RSA signing key
			const rsaKey = keys.find((key) => key.kty === "RSA" && key.use === "sig");
			if (!rsaKey) {
				throw new Error("No RSA signing key found in JWKS");
			}

			// Import the public key
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

/**
 * Creates a Next.js middleware for Melody Auth authentication
 *
 * @param config - Middleware configuration options
 * @returns Middleware function that validates JWT tokens and protects routes
 *
 * @example
 * ```ts
 * // middleware.ts
 * export default createMelodyAuthMiddleware({
 *   publicKey: process.env.MELODY_PUBLIC_KEY,
 *   publicPaths: ['/login', '/api/public'],
 *   redirectPath: '/login'
 * });
 * ```
 */
export function createMelodyAuthMiddleware(config: MelodyAuthMiddlewareConfig) {
	return async function middleware(request: NextRequest) {
		const pathname = request.nextUrl.pathname;

		// Check if path is public
		if (config.publicPaths?.some((path) => pathname.startsWith(path))) {
			return NextResponse.next();
		}

		const storage = new CookieStorage({
			request,
			...config.cookieOptions,
		});

		try {
			// Get tokens from cookies
			const idTokenStr = storage.getItem(StorageKey.IdToken);
			const accessTokenStr = storage.getItem(StorageKey.AccessToken);

			// Access token is required, ID token is optional (depends on openid scope)
			if (!accessTokenStr) {
				return redirectToLogin(request, config.redirectPath);
			}

			const idTokenStorage = readIdTokenStorage(idTokenStr);
			const accessTokenStorage = readAccessTokenStorage(accessTokenStr);
			if (idTokenStr && !idTokenStorage) return redirectToLogin(request, config.redirectPath);

			// Validate tokens
			const { hasValidIdToken, hasValidAccessToken } = isValidTokens(
				accessTokenStorage,
				null,
				idTokenStorage,
			);

			// Access token is required, ID token is optional
			if (!hasValidAccessToken || !accessTokenStorage) {
				return redirectToLogin(request, config.redirectPath);
			}

			// If ID token exists, it must be valid
			if (idTokenStorage && !hasValidIdToken) {
				return redirectToLogin(request, config.redirectPath);
			}

			// Verify JWT signature if ID token exists and public key is configured
			let userId: string | undefined;
			let account: JWTPayload | undefined;

			if (idTokenStorage && (config.publicKey || config.jwksUri)) {
				const publicKey = await getPublicKey(config);
				const { payload } = await jwtVerify(idTokenStorage.idToken, publicKey);
				userId = payload.sub;
				account = payload;
			} else if (idTokenStorage) {
				// If no public key configured but ID token exists, use the stored account info
				userId = idTokenStorage.account.sub;
				account = { ...idTokenStorage.account };
			}

			// Add auth info to request headers
			const response = NextResponse.next();

			// Only set user ID and account if we have ID token info
			if (userId && account) {
				response.headers.set("x-auth-user-id", userId);
				response.headers.set("x-auth-account", JSON.stringify(account));
			}

			response.headers.set("x-auth-access-token", accessTokenStorage.accessToken);

			return response;
		} catch (error) {
			// Edge Runtime compatible error handling
			if (typeof console !== "undefined" && console.error) {
				console.error("Auth middleware error:", error);
			}
			return redirectToLogin(request, config.redirectPath);
		}
	};
}

/**
 * Creates a redirect response to the login page
 * Preserves the original URL as a return URL parameter
 */
function redirectToLogin(request: NextRequest, redirectPath = "/login") {
	const url = request.nextUrl.clone();
	url.pathname = redirectPath;
	url.searchParams.set("returnUrl", request.nextUrl.pathname);
	return NextResponse.redirect(url);
}

/**
 * Higher-order function that wraps a middleware with authentication
 * Provides authenticated request object to the wrapped middleware
 *
 * @param middleware - The middleware function to wrap
 * @param config - Authentication configuration
 * @returns Wrapped middleware that includes authentication
 *
 * @example
 * ```ts
 * export default withAuth(
 *   async (request) => {
 *     // Access authenticated user info
 *     console.log('User ID:', request.auth?.userId);
 *     return NextResponse.next();
 *   },
 *   { publicKey: process.env.MELODY_PUBLIC_KEY }
 * );
 * ```
 */
export function withAuth(
	middleware: (request: AuthenticatedRequest) => NextResponse | Promise<NextResponse>,
	config: MelodyAuthMiddlewareConfig,
) {
	const authMiddleware = createMelodyAuthMiddleware(config);

	return async function wrappedMiddleware(request: NextRequest) {
		const authResponse = await authMiddleware(request);

		if (authResponse.status === 307) {
			// Redirect response
			return authResponse;
		}

		// Extract auth info from headers
		const userId = authResponse.headers.get("x-auth-user-id");
		const accountStr = authResponse.headers.get("x-auth-account");
		const accessToken = authResponse.headers.get("x-auth-access-token");

		// Access token is required, user info is optional
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
