import { createGzipDecoder, unpackTar } from "modern-tar";

import { pluginManifestSchema, reconcileManifestAccess } from "./manifest-schema.js";
import type { PluginManifest } from "./types.js";

const TRAILING_SLASHES = /\/+$/;
const LEADING_DOT_SLASH = /^\.\//;

export interface MarketplacePluginSummary {
	id: string;
	name: string;
	description: string | null;
	author: {
		name: string;
		verified: boolean;
		avatarUrl: string | null;
	};
	capabilities: string[];
	keywords: string[];
	installCount: number;
	hasIcon: boolean;
	iconUrl: string;
	latestVersion?: {
		version: string;
		audit?: {
			verdict: string;
			riskScore: number;
		};
		imageAudit?: {
			verdict: string;
		};
	};
	createdAt: string;
	updatedAt: string;
}

export interface MarketplaceVersionSummary {
	version: string;
	minEmDashVersion: string | null;
	bundleSize: number;
	checksum: string;
	changelog: string | null;
	capabilities: string[];
	status: string;
	auditVerdict: string | null;
	imageAuditVerdict: string | null;
	publishedAt: string;
}

export interface MarketplacePluginDetail extends MarketplacePluginSummary {
	repositoryUrl: string | null;
	homepageUrl: string | null;
	license: string | null;
	latestVersion?: {
		version: string;
		minEmDashVersion: string | null;
		bundleSize: number;
		checksum: string;
		changelog: string | null;
		readme: string | null;
		hasIcon: boolean;
		screenshotCount: number;
		screenshotUrls: string[];
		capabilities: string[];
		status: string;
		audit?: {
			verdict: string;
			riskScore: number;
		};
		imageAudit?: {
			verdict: string;
		};
		publishedAt: string;
	};
}

export interface MarketplaceSearchOpts {
	category?: string;
	capability?: string;
	sort?: "installs" | "updated" | "created" | "name";
	cursor?: string;
	limit?: number;
}

export interface MarketplaceSearchResult {
	items: MarketplacePluginSummary[];
	nextCursor?: string;
}

export interface MarketplaceThemeSummary {
	id: string;
	name: string;
	description: string | null;
	author: {
		name: string;
		verified: boolean;
		avatarUrl: string | null;
	};
	keywords: string[];
	previewUrl: string;
	demoUrl: string | null;
	hasThumbnail: boolean;
	thumbnailUrl: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface MarketplaceThemeDetail extends MarketplaceThemeSummary {
	author: {
		id: string;
		name: string;
		verified: boolean;
		avatarUrl: string | null;
	};
	repositoryUrl: string | null;
	homepageUrl: string | null;
	license: string | null;
	screenshotCount: number;
	screenshotUrls: string[];
}

export interface MarketplaceThemeSearchOpts {
	keyword?: string;
	sort?: "name" | "created" | "updated";
	cursor?: string;
	limit?: number;
}

export interface MarketplaceThemeSearchResult {
	items: MarketplaceThemeSummary[];
	nextCursor?: string;
}

export interface PluginBundle {
	manifest: PluginManifest;
	backendCode: string;
	adminCode?: string;
	checksum: string;
}

export interface MarketplaceClient {
	search(query?: string, opts?: MarketplaceSearchOpts): Promise<MarketplaceSearchResult>;

	getPlugin(id: string): Promise<MarketplacePluginDetail>;

	getVersions(id: string): Promise<MarketplaceVersionSummary[]>;

	downloadBundle(id: string, version: string): Promise<PluginBundle>;

	reportInstall(id: string, version: string): Promise<void>;

	searchThemes(
		query?: string,
		opts?: MarketplaceThemeSearchOpts,
	): Promise<MarketplaceThemeSearchResult>;

	getTheme(id: string): Promise<MarketplaceThemeDetail>;
}

export class MarketplaceError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
		public readonly code?: string,
	) {
		super(message);
		this.name = "MarketplaceError";
	}
}

export class MarketplaceUnavailableError extends MarketplaceError {
	constructor(cause?: unknown) {
		super("Plugin marketplace is unavailable", undefined, "MARKETPLACE_UNAVAILABLE");
		if (cause) this.cause = cause;
	}
}

class MarketplaceClientImpl implements MarketplaceClient {
	private readonly baseUrl: string;
	private readonly siteOrigin: string | undefined;

	constructor(baseUrl: string, siteOrigin?: string) {
		this.baseUrl = baseUrl.replace(TRAILING_SLASHES, "");
		this.siteOrigin = siteOrigin;
	}

	async search(query?: string, opts?: MarketplaceSearchOpts): Promise<MarketplaceSearchResult> {
		const params = new URLSearchParams();
		if (query) params.set("q", query);
		if (opts?.category) params.set("category", opts.category);
		if (opts?.capability) params.set("capability", opts.capability);
		if (opts?.sort) params.set("sort", opts.sort);
		if (opts?.cursor) params.set("cursor", opts.cursor);
		if (opts?.limit) params.set("limit", String(opts.limit));

		const qs = params.toString();
		const url = `${this.baseUrl}/api/v1/plugins${qs ? `?${qs}` : ""}`;
		const data = await this.fetchJson<MarketplaceSearchResult>(url);
		return data;
	}

	async getPlugin(id: string): Promise<MarketplacePluginDetail> {
		const url = `${this.baseUrl}/api/v1/plugins/${encodeURIComponent(id)}`;
		return this.fetchJson<MarketplacePluginDetail>(url);
	}

	async getVersions(id: string): Promise<MarketplaceVersionSummary[]> {
		const url = `${this.baseUrl}/api/v1/plugins/${encodeURIComponent(id)}/versions`;
		const data = await this.fetchJson<{ items: MarketplaceVersionSummary[] }>(url);
		return data.items;
	}

	async downloadBundle(id: string, version: string): Promise<PluginBundle> {
		const bundleUrl = `${this.baseUrl}/api/v1/plugins/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/bundle`;

		const marketplaceOrigin = new URL(this.baseUrl).origin;
		const MAX_REDIRECTS = 5;
		let response: Response;
		try {
			let currentUrl = bundleUrl;
			response = await fetch(currentUrl, { redirect: "manual" });

			for (let i = 0; i < MAX_REDIRECTS; i++) {
				if (response.status < 300 || response.status >= 400) break;

				const location = response.headers.get("location");
				if (!location) break;

				const target = new URL(location, currentUrl);
				if (target.origin !== marketplaceOrigin) {
					throw new MarketplaceError(
						`Bundle download redirected to untrusted host: ${target.origin}`,
						response.status,
						"BUNDLE_REDIRECT_UNTRUSTED",
					);
				}
				currentUrl = target.href;
				response = await fetch(currentUrl, { redirect: "manual" });
			}

			if (response.status >= 300 && response.status < 400) {
				throw new MarketplaceError(
					`Bundle download exceeded maximum redirects (${MAX_REDIRECTS})`,
					response.status,
					"BUNDLE_TOO_MANY_REDIRECTS",
				);
			}
		} catch (err) {
			if (err instanceof MarketplaceError) throw err;
			throw new MarketplaceUnavailableError(err);
		}

		if (!response.ok) {
			throw new MarketplaceError(
				`Failed to download bundle: ${response.status} ${response.statusText}`,
				response.status,
				"BUNDLE_DOWNLOAD_FAILED",
			);
		}

		const tarballBytes = new Uint8Array(await response.arrayBuffer());
		try {
			return await extractBundle(tarballBytes);
		} catch (err) {
			if (err instanceof MarketplaceError) throw err;
			throw new MarketplaceError(
				"Failed to extract plugin bundle",
				undefined,
				"BUNDLE_EXTRACT_FAILED",
			);
		}
	}

	async reportInstall(id: string, version: string): Promise<void> {
		const siteHash = await generateSiteHash(this.siteOrigin);
		const url = `${this.baseUrl}/api/v1/plugins/${encodeURIComponent(id)}/installs`;

		try {
			await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ siteHash, version }),
			});
		} catch {}
	}

	async searchThemes(
		query?: string,
		opts?: MarketplaceThemeSearchOpts,
	): Promise<MarketplaceThemeSearchResult> {
		const params = new URLSearchParams();
		if (query) params.set("q", query);
		if (opts?.keyword) params.set("keyword", opts.keyword);
		if (opts?.sort) params.set("sort", opts.sort);
		if (opts?.cursor) params.set("cursor", opts.cursor);
		if (opts?.limit) params.set("limit", String(opts.limit));

		const qs = params.toString();
		const url = `${this.baseUrl}/api/v1/themes${qs ? `?${qs}` : ""}`;
		return this.fetchJson<MarketplaceThemeSearchResult>(url);
	}

	async getTheme(id: string): Promise<MarketplaceThemeDetail> {
		const url = `${this.baseUrl}/api/v1/themes/${encodeURIComponent(id)}`;
		return this.fetchJson<MarketplaceThemeDetail>(url);
	}

	private async fetchJson<T>(url: string): Promise<T> {
		let response: Response;
		try {
			response = await fetch(url, {
				headers: { Accept: "application/json" },
			});
		} catch (err) {
			throw new MarketplaceUnavailableError(err);
		}

		if (!response.ok) {
			let errorMessage = `Marketplace request failed: ${response.status}`;
			try {
				const body: { error?: string } = await response.json();
				if (body.error) errorMessage = body.error;
			} catch {}
			throw new MarketplaceError(errorMessage, response.status);
		}

		const data: T = await response.json();
		return data;
	}
}

const MAX_DECOMPRESSED_BUNDLE_BYTES = 256 * 1024;
const MAX_BUNDLE_TAR_ENTRIES = 32;

export async function extractBundle(tarballBytes: Uint8Array): Promise<PluginBundle> {
	const decompressedStream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(tarballBytes);
			controller.close();
		},
	}).pipeThrough(createGzipDecoder());

	const reader = decompressedStream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > MAX_DECOMPRESSED_BUNDLE_BYTES) {
			try {
				await reader.cancel();
			} catch {}
			throw new MarketplaceError(
				`Bundle decompressed size exceeds limit (${MAX_DECOMPRESSED_BUNDLE_BYTES} bytes)`,
				undefined,
				"INVALID_BUNDLE",
			);
		}
		chunks.push(value);
	}
	const decompressedBytes = new Uint8Array(total);
	{
		let offset = 0;
		for (const chunk of chunks) {
			decompressedBytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
	}

	const decompressed = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(decompressedBytes);
			controller.close();
		},
	});

	const entries = await unpackTar(decompressed);
	if (entries.length > MAX_BUNDLE_TAR_ENTRIES) {
		throw new MarketplaceError(
			`Bundle has too many tar entries (${entries.length} > ${MAX_BUNDLE_TAR_ENTRIES})`,
			undefined,
			"INVALID_BUNDLE",
		);
	}

	const decoder = new TextDecoder();
	const files = new Map<string, string>();
	for (const entry of entries) {
		if (entry.data && entry.header.type === "file") {
			const name = entry.header.name.replace(LEADING_DOT_SLASH, "");
			files.set(name, decoder.decode(entry.data));
		}
	}

	const manifestJson = files.get("manifest.json");
	const backendCode = files.get("backend.js");

	if (!manifestJson) {
		throw new MarketplaceError(
			"Invalid bundle: missing manifest.json",
			undefined,
			"INVALID_BUNDLE",
		);
	}
	if (!backendCode) {
		throw new MarketplaceError("Invalid bundle: missing backend.js", undefined, "INVALID_BUNDLE");
	}

	let manifest: PluginManifest;
	try {
		const parsed: unknown = JSON.parse(manifestJson);
		const result = pluginManifestSchema.safeParse(parsed);
		if (!result.success) {
			throw new MarketplaceError(
				"Invalid bundle: manifest.json failed validation",
				undefined,
				"INVALID_BUNDLE",
			);
		}
		manifest = reconcileManifestAccess(result.data);
	} catch (err) {
		if (err instanceof MarketplaceError) throw err;
		throw new MarketplaceError(
			"Invalid bundle: malformed manifest.json",
			undefined,
			"INVALID_BUNDLE",
		);
	}

	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Uint8Array is a valid BufferSource at runtime; TS lib mismatch
	const hashBuffer = await crypto.subtle.digest("SHA-256", tarballBytes as unknown as BufferSource);
	const hashArray = new Uint8Array(hashBuffer);
	const checksum = Array.from(hashArray, (b) => b.toString(16).padStart(2, "0")).join("");

	return {
		manifest,
		backendCode,
		adminCode: files.get("admin.js"),
		checksum,
	};
}

async function generateSiteHash(siteOrigin?: string): Promise<string> {
	const seed = siteOrigin ? `emdash-site:${siteOrigin}` : `emdash-anonymous`;
	try {
		const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
		const arr = new Uint8Array(hash);
		return Array.from(arr.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
	} catch {
		let h = 0x811c9dc5;
		for (let i = 0; i < seed.length; i++) {
			h ^= seed.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		const h2 = h ^ (h >>> 16);
		return (h >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
	}
}

export function createMarketplaceClient(baseUrl: string, siteOrigin?: string): MarketplaceClient {
	return new MarketplaceClientImpl(baseUrl, siteOrigin);
}
