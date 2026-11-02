import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Interceptor } from "./transport.js";

const execFileAsync = promisify(execFile);

function parseHeaderLine(line: string): [string, string] | null {
	const idx = line.indexOf(":");
	if (idx === -1) return null;
	const name = line.slice(0, idx).trim();
	const value = line.slice(idx + 1).trim();
	if (!name) return null;
	return [name, value];
}

export function parseHeadersFromEnv(): Record<string, string> {
	const raw = process.env["EMDASH_HEADERS"];
	if (!raw) return {};
	return parseHeaderStrings(raw.split("\n"));
}

export function parseHeaderStrings(headers: string[]): Record<string, string> {
	const result: Record<string, string> = {};
	for (const h of headers) {
		const parsed = parseHeaderLine(h);
		if (parsed) {
			result[parsed[0]] = parsed[1];
		}
	}
	return result;
}

export function parseHeadersFromArgv(): string[] {
	const headers: string[] = [];
	const argv = process.argv;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--header" || arg === "-H") {
			const next = argv[i + 1];
			if (next && !next.startsWith("-")) {
				headers.push(next);
				i++;
			}
		} else if (arg.startsWith("--header=")) {
			headers.push(arg.slice("--header=".length));
		} else if (arg.startsWith("-H=")) {
			headers.push(arg.slice("-H=".length));
		}
	}
	return headers;
}

export function resolveCustomHeaders(): Record<string, string> {
	const envHeaders = parseHeadersFromEnv();
	const cliHeaders = parseHeaderStrings(parseHeadersFromArgv());
	return { ...envHeaders, ...cliHeaders };
}

export function customHeadersInterceptor(headers: Record<string, string>): Interceptor {
	const entries = Object.entries(headers);
	if (entries.length === 0) {
		return (request, next) => next(request);
	}

	return (request, next) => {
		const h = new Headers(request.headers);
		for (const [name, value] of entries) {
			h.set(name, value);
		}
		return next(new Request(request, { headers: h }));
	};
}

export function createHeaderAwareFetch(headers: Record<string, string>): typeof fetch {
	if (Object.keys(headers).length === 0) {
		return globalThis.fetch.bind(globalThis);
	}
	return (input: RequestInfo | URL, init?: RequestInit) => {
		const h = new Headers(init?.headers);
		for (const [name, value] of Object.entries(headers)) {
			h.set(name, value);
		}
		return globalThis.fetch(input, { ...init, headers: h });
	};
}

const ACCESS_LOGIN_PATTERN = /cloudflareaccess\.com\/cdn-cgi\/access\/login/;

export function isAccessRedirect(response: Response): boolean {
	if (response.status !== 301 && response.status !== 302) return false;
	const location = response.headers.get("location") ?? "";
	return ACCESS_LOGIN_PATTERN.test(location);
}

export async function getCachedAccessToken(appUrl: string): Promise<string | null> {
	const origin = new URL(appUrl).origin;
	try {
		const { stdout } = await execFileAsync("cloudflared", ["access", "token", "-app", origin]);
		const token = stdout.trim();
		return token || null;
	} catch {
		return null;
	}
}

export async function runCloudflaredLogin(appUrl: string): Promise<boolean> {
	const origin = new URL(appUrl).origin;
	try {
		await execFileAsync("cloudflared", ["access", "login", origin]);
		return true;
	} catch {
		return false;
	}
}
