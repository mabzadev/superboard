import { CookieStorage as SharedCookieStorage } from "@melody-auth/shared";
import { getCookie, setCookie, deleteCookie } from "cookies-next";
import type { NextRequest, NextResponse } from "next/server";

/**
 * Determines if cookies should be secure based on the actual connection
 */
function shouldUseSecureCookies(request?: NextRequest): boolean {
	// If explicitly set, use that
	if (process.env.NODE_ENV === "development") {
		return false; // Allow non-HTTPS in development
	}

	// Check the actual request protocol if available
	if (request && request.headers) {
		try {
			const protocol =
				request.headers.get("x-forwarded-proto") ||
				(request.nextUrl && request.nextUrl.protocol) ||
				"https:"; // Default to secure in production
			return protocol === "https:";
		} catch {
			// If request object is malformed, fall through to defaults
		}
	}

	// Check window location if available (client-side)
	if (typeof window !== "undefined" && window.location) {
		return window.location.protocol === "https:";
	}

	// Default to secure in production, insecure in development
	return process.env.NODE_ENV === "production";
}

/**
 * Next.js specific cookie options
 */
export interface CookieOptions {
	request?: NextRequest;
	response?: NextResponse;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: "lax" | "strict" | "none";
	path?: string;
	domain?: string;
	maxAge?: number;
}

/**
 * Cookie storage implementation for Next.js
 * Wraps the shared CookieStorage with Next.js specific adapters
 */
export class CookieStorage {
	private storage: SharedCookieStorage;

	constructor(private options: CookieOptions = {}) {
		const isSecure = options.secure ?? shouldUseSecureCookies(options.request);

		// Create shared storage with Next.js specific cookie handlers
		this.storage = new SharedCookieStorage({
			httpOnly: options.httpOnly ?? true,
			secure: isSecure,
			sameSite: options.sameSite ?? "lax",
			path: options.path ?? "/",
			domain: options.domain,
			maxAge: options.maxAge,
			cookieGetter: (key: string) => {
				const req = options.request;
				const res = options.response;
				const value = getCookie(key, { req, res });
				if (value instanceof Promise) {
					value.catch(() => {
						console.error("Cookie read failed");
					});
					return null;
				}
				return typeof value === "string" ? value || null : null;
			},
			cookieSetter: (key: string, value: string) => {
				const req = options.request;
				const res = options.response;
				if (value === "") {
					Promise.resolve(
						deleteCookie(key, {
							req,
							res,
						}),
					).catch(() => {
						console.error("Cookie deletion failed");
					});
				} else {
					Promise.resolve(
						setCookie(key, value, {
							req,
							res,
							httpOnly: options.httpOnly ?? true,
							secure: isSecure,
							sameSite: options.sameSite ?? "lax",
							path: options.path ?? "/",
							domain: options.domain,
							maxAge: options.maxAge,
						}),
					).catch(() => {
						console.error("Cookie update failed");
					});
				}
			},
		});
	}

	async getItemAsync(key: string): Promise<string | null> {
		const value = await getCookie(key, { req: this.options.request, res: this.options.response });
		return typeof value === "string" ? value || null : null;
	}
	async setItemAsync(key: string, value: string): Promise<void> {
		const options = {
			req: this.options.request,
			res: this.options.response,
			httpOnly: this.options.httpOnly ?? true,
			secure: this.options.secure ?? shouldUseSecureCookies(this.options.request),
			sameSite: this.options.sameSite ?? "lax",
			path: this.options.path ?? "/",
			domain: this.options.domain,
			maxAge: this.options.maxAge,
		};
		if (value === "") await deleteCookie(key, options);
		else await setCookie(key, value, options);
	}

	getItem(key: string): string | null {
		return this.storage.getItem(key);
	}

	setItem(key: string, value: string): void {
		this.storage.setItem(key, value);
	}

	removeItem(key: string): void {
		this.storage.removeItem(key);
	}
}
