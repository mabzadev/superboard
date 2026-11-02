import type { Did } from "@atcute/lexicons";
import { evaluateRegistryReleaseWithdrawal } from "@emdash-cms/registry-client/withdrawal";
import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError } from "#api/error.js";
import { verifyChecksum } from "#api/handlers/registry.js";
import { assertSafeArtifactUrl } from "#api/index.js";

import { fetchRegistryArtifactUrl } from "../../../../../../registry/artifact-fetch.js";
import { coerceRegistryConfig, validateAggregatorUrl } from "../../../../../../registry/config.js";

export const prerender = false;

const ALLOWED_IMAGE_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"image/avif",
]);

const ALLOWED_KINDS = new Set(["icon", "banner", "screenshot"]);

const DID_PATTERN = /^did:[a-z]+:.+/;
const SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const CID_PATTERN = /^b[a-z2-7]+$/;
const INDEX_PATTERN = /^\d+$/;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MAX_REDIRECTS = 5;

const FETCH_TIMEOUT_MS = 15_000;

const AGGREGATOR_REQUEST_TIMEOUT_MS = 15_000;
const AGGREGATOR_TOTAL_BUDGET_MS = 30_000;

const MAX_LIST_PAGES = 20;

function timedFetch(totalDeadline: number): typeof fetch {
	return (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
		const now = Date.now();
		const remaining = Math.max(0, totalDeadline - now);
		if (remaining === 0) {
			return Promise.reject(new Error("Aggregator request budget exhausted"));
		}
		const timeout = Math.min(AGGREGATOR_REQUEST_TIMEOUT_MS, remaining);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeout);
		const callerSignal = init?.signal;
		if (callerSignal) {
			if (callerSignal.aborted) controller.abort(callerSignal.reason);
			else callerSignal.addEventListener("abort", () => controller.abort(callerSignal.reason));
		}
		return fetch(input, { ...init, signal: controller.signal }).finally(() => {
			clearTimeout(timer);
		});
	};
}

interface DeclaredArtifact {
	url: string;
	checksum: string;
}

function declaredArtifact(value: unknown): DeclaredArtifact | null {
	if (!value || typeof value !== "object") return null;
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowed to non-null object above; fields checked below
	const entry = value as Record<string, unknown>;
	const url = entry.url;
	const checksum = entry.checksum;
	if (
		typeof url !== "string" ||
		url.length === 0 ||
		typeof checksum !== "string" ||
		checksum.length === 0
	) {
		return null;
	}
	return { url, checksum };
}

function resolveDeclaredArtifact(
	artifacts: unknown,
	kind: string,
	index: number,
): DeclaredArtifact | null {
	if (!artifacts || typeof artifacts !== "object") return null;
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowed to non-null object above; each entry shape-narrowed by declaredArtifactUrl
	const map = artifacts as Record<string, unknown>;

	if (kind === "icon") return declaredArtifact(map.icon);
	if (kind === "banner") return declaredArtifact(map.banner);
	const screenshots = map.screenshots;
	if (!Array.isArray(screenshots)) return null;
	if (index < 0 || index >= screenshots.length) return null;
	return declaredArtifact(screenshots[index]);
}

export const GET: APIRoute = async ({ url, locals }) => {
	const { emdash, user } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const denied = requirePerm(user, "plugins:read");
	if (denied) return denied;

	const did = url.searchParams.get("did");
	const slug = url.searchParams.get("slug");
	const cid = url.searchParams.get("cid");
	const kind = url.searchParams.get("kind");
	const versionParam = url.searchParams.get("version");
	const indexParam = url.searchParams.get("index");

	if (!did || !slug || !cid || !kind) {
		return apiError("INVALID_REQUEST", "Missing did, slug, cid, or kind", 400);
	}
	if (did.length > 256 || !DID_PATTERN.test(did)) {
		return apiError("INVALID_REQUEST", "Invalid did", 400);
	}
	if (slug.length > 64 || !SLUG_PATTERN.test(slug)) {
		return apiError("INVALID_REQUEST", "Invalid slug", 400);
	}
	if (cid.length > 256 || !CID_PATTERN.test(cid)) {
		return apiError("INVALID_REQUEST", "Invalid release CID", 400);
	}
	if (!ALLOWED_KINDS.has(kind)) {
		return apiError("INVALID_REQUEST", "Invalid kind", 400);
	}

	let index = 0;
	if (kind === "screenshot") {
		if (indexParam === null) {
			return apiError("INVALID_REQUEST", "Missing index for screenshot", 400);
		}
		if (!INDEX_PATTERN.test(indexParam)) {
			return apiError("INVALID_REQUEST", "Invalid index", 400);
		}
		index = Number(indexParam);
		if (!Number.isSafeInteger(index)) {
			return apiError("INVALID_REQUEST", "Invalid index", 400);
		}
	}

	let version: string | undefined;
	if (versionParam !== null && versionParam.length > 0) {
		if (versionParam.length > 64) {
			return apiError("INVALID_REQUEST", "Invalid version", 400);
		}
		version = versionParam;
	}

	const registryConfig = coerceRegistryConfig(emdash.config.experimental?.registry);
	if (!registryConfig) {
		return apiError("REGISTRY_NOT_CONFIGURED", "Registry is not configured", 400);
	}
	try {
		validateAggregatorUrl(registryConfig.aggregatorUrl);
	} catch {
		return apiError("REGISTRY_NOT_CONFIGURED", "Registry aggregator URL is invalid", 500);
	}

	let descriptor: DeclaredArtifact;
	try {
		const resolved = await resolveArtifact(registryConfig, did, slug, version, cid, kind, index);
		if (resolved === null) {
			return apiError("ARTIFACT_NOT_FOUND", "Artifact not found", 404);
		}
		descriptor = resolved;
	} catch {
		return apiError("ARTIFACT_RESOLVE_FAILED", "Failed to resolve artifact", 502);
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		let current: URL;
		try {
			current = await assertSafeArtifactUrl(descriptor.url);
		} catch {
			return apiError("ARTIFACT_URL_REJECTED", "Artifact URL is not allowed", 400);
		}

		let response: Response;
		for (let hop = 0; ; hop++) {
			response = await fetchRegistryArtifactUrl(current.href, {
				signal: controller.signal,
				maxResponseBytes: MAX_IMAGE_BYTES,
			});
			if (response.status < 300 || response.status >= 400) break;
			const location = response.headers.get("location");
			if (!location) break;
			if (hop === MAX_REDIRECTS) {
				return apiError("ARTIFACT_URL_REJECTED", "Too many redirects", 502);
			}
			let next: URL;
			try {
				next = await assertSafeArtifactUrl(new URL(location, current).href);
			} catch {
				return apiError("ARTIFACT_URL_REJECTED", "Redirect target is not allowed", 400);
			}
			current = next;
		}

		if (!response.ok) {
			return apiError("ARTIFACT_FETCH_FAILED", "Failed to fetch artifact", 502);
		}

		const rawType = response.headers.get("content-type") ?? "";
		const contentType = rawType.split(";", 1)[0]!.trim().toLowerCase();
		if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
			return apiError("ARTIFACT_NOT_IMAGE", "Artifact is not an allowed image type", 415);
		}

		const declaredLength = response.headers.get("content-length");
		if (declaredLength) {
			const declared = Number(declaredLength);
			if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
				return apiError("ARTIFACT_TOO_LARGE", "Artifact exceeds size limit", 413);
			}
		}

		const bytes = await readCapped(response, MAX_IMAGE_BYTES);
		if (bytes === null) {
			return apiError("ARTIFACT_TOO_LARGE", "Artifact exceeds size limit", 413);
		}
		if (!(await verifyChecksum(bytes, descriptor.checksum))) {
			return apiError(
				"ARTIFACT_CHECKSUM_MISMATCH",
				"Artifact bytes do not match the approved release record",
				502,
			);
		}

		return new Response(bytes, {
			headers: {
				"Content-Type": contentType,
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
				"Content-Disposition": "attachment",
				"Content-Security-Policy": "default-src 'none'; sandbox",
			},
		});
	} catch {
		return apiError("ARTIFACT_FETCH_FAILED", "Failed to fetch artifact", 502);
	} finally {
		clearTimeout(timer);
	}
};

async function resolveArtifact(
	registryConfig: { aggregatorUrl: string; acceptLabelers?: string },
	did: string,
	slug: string,
	version: string | undefined,
	cid: string,
	kind: string,
	index: number,
): Promise<DeclaredArtifact | null> {
	const { DiscoveryClient, registryLabelerPolicy } =
		await import("@emdash-cms/registry-client/discovery");

	const aggregatorDeadline = Date.now() + AGGREGATOR_TOTAL_BUDGET_MS;
	const discovery = new DiscoveryClient({
		aggregatorUrl: registryConfig.aggregatorUrl,
		acceptLabelers: registryConfig.acceptLabelers,
		labelerPolicy: registryLabelerPolicy(registryConfig.acceptLabelers),
		fetch: timedFetch(aggregatorDeadline),
	});

	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- DID shape validated by the route before this call
	const publisherDid = did as Did;

	const releaseView = await (async () => {
		if (!version) {
			return discovery.getLatestRelease({ did: publisherDid, package: slug });
		}
		let cursor: string | undefined;
		const seenCursors = new Set<string>();
		for (let page = 0; page < MAX_LIST_PAGES; page++) {
			if (cursor !== undefined) {
				if (seenCursors.has(cursor)) break;
				seenCursors.add(cursor);
			}
			const result = await discovery.listReleases({
				did: publisherDid,
				package: slug,
				cursor,
				limit: 50,
			});
			for (const r of result.releases) {
				if (r.version === version) return r;
			}
			if (!result.cursor) break;
			cursor = result.cursor;
		}
		return undefined;
	})();

	if (
		!releaseView?.release ||
		releaseView.cid !== cid ||
		releaseView.did !== publisherDid ||
		releaseView.package !== slug ||
		(version !== undefined && releaseView.version !== version) ||
		releaseView.release.package !== slug ||
		releaseView.release.version !== releaseView.version
	) {
		return null;
	}
	if (evaluateRegistryReleaseWithdrawal(releaseView, discovery.labelerPolicy).withdrawn) {
		return null;
	}

	return resolveDeclaredArtifact(releaseView.release.artifacts, kind, index);
}

async function readCapped(response: Response, limit: number): Promise<Uint8Array | null> {
	const body = response.body;
	if (!body) {
		const buf = new Uint8Array(await response.arrayBuffer());
		return buf.length > limit ? null : buf;
	}
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			total += value.length;
			if (total > limit) {
				await reader.cancel();
				return null;
			}
			chunks.push(value);
		}
	}
	const combined = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.length;
	}
	return combined;
}
