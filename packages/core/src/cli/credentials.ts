import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface StoredCredential {
	accessToken: string;
	refreshToken: string;
	expiresAt: string;
	url?: string;
	customHeaders?: Record<string, string>;
	user?: {
		email: string;
		role: string;
	};
}

export interface MarketplaceCredential {
	token: string;
	expiresAt: string;
	author?: {
		id: string;
		name: string;
	};
}

type CredentialStore = Record<string, StoredCredential | MarketplaceCredential>;

function getConfigDir(): string {
	const xdg = process.env["XDG_CONFIG_HOME"];
	if (xdg) return join(xdg, "emdash");
	return join(homedir(), ".config", "emdash");
}

function getCredentialPath(): string {
	return join(getConfigDir(), "auth.json");
}

export function resolveCredentialKey(baseUrl: string): string {
	try {
		const url = new URL(baseUrl);
		const isLocal =
			url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";

		if (isLocal) {
			const projectPath = findProjectRoot(process.cwd());
			if (projectPath) {
				return `path:${projectPath}`;
			}
			return url.origin;
		}

		return url.origin;
	} catch {
		return baseUrl;
	}
}

function findProjectRoot(from: string): string | null {
	let dir = resolve(from);
	const root = resolve("/");

	while (dir !== root) {
		for (const name of [
			"astro.config.ts",
			"astro.config.mts",
			"astro.config.js",
			"astro.config.mjs",
		]) {
			if (existsSync(join(dir, name))) {
				return dir;
			}
		}
		const parent = resolve(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}

	return null;
}

function readStore(): CredentialStore {
	const path = getCredentialPath();
	try {
		if (existsSync(path)) {
			const content = readFileSync(path, "utf-8");
			return JSON.parse(content) as CredentialStore;
		}
	} catch {}
	return {};
}

function writeStore(store: CredentialStore): void {
	const dir = getConfigDir();
	mkdirSync(dir, { recursive: true, mode: 0o700 });

	const path = getCredentialPath();
	writeFileSync(path, JSON.stringify(store, null, "\t"), {
		encoding: "utf-8",
		mode: 0o600,
	});
}

export function getCredentials(baseUrl: string): StoredCredential | null {
	const key = resolveCredentialKey(baseUrl);
	const store = readStore();
	const cred = store[key];
	if (!cred || !("accessToken" in cred)) return null;
	return cred;
}

export function saveCredentials(baseUrl: string, cred: StoredCredential): void {
	const key = resolveCredentialKey(baseUrl);
	const store = readStore();
	store[key] = cred;
	writeStore(store);
}

export function removeCredentials(baseUrl: string): boolean {
	const key = resolveCredentialKey(baseUrl);
	const store = readStore();
	if (key in store) {
		delete store[key];
		writeStore(store);
		return true;
	}
	return false;
}

export function listCredentialKeys(): string[] {
	const store = readStore();
	return Object.keys(store);
}

function marketplaceKey(registryUrl: string): string {
	try {
		return `marketplace:${new URL(registryUrl).origin}`;
	} catch {
		return `marketplace:${registryUrl}`;
	}
}

export function getMarketplaceCredential(registryUrl: string): MarketplaceCredential | null {
	const key = marketplaceKey(registryUrl);
	const store = readStore();
	const cred = store[key];
	if (!cred || !("token" in cred)) return null;
	if (new Date(cred.expiresAt) < new Date()) return null;
	return cred;
}

export function saveMarketplaceCredential(registryUrl: string, cred: MarketplaceCredential): void {
	const key = marketplaceKey(registryUrl);
	const store = readStore();
	store[key] = cred;
	writeStore(store);
}

export function removeMarketplaceCredential(registryUrl: string): boolean {
	const key = marketplaceKey(registryUrl);
	const store = readStore();
	if (key in store) {
		delete store[key];
		writeStore(store);
		return true;
	}
	return false;
}
