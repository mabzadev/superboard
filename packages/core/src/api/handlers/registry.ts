import { ClientResponseError, ClientValidationError } from "@atcute/client";
import type { Did } from "@atcute/lexicons";
import { checkEnvCompatibility, findSkippedEnvConstraints } from "@emdash-cms/registry-client/env";
import type { HostEnv } from "@emdash-cms/registry-client/env";
import { evaluateRegistryReleaseWithdrawal } from "@emdash-cms/registry-client/withdrawal";
import type { Kysely } from "kysely";

import type { Database } from "../../database/types.js";
import { extractBundle } from "../../plugins/marketplace.js";
import type { PluginBundle } from "../../plugins/marketplace.js";
import type { SandboxRunner } from "../../plugins/sandbox/types.js";
import { PluginStateRepository } from "../../plugins/state.js";
import {
	removeAllPluginIndexes,
	syncDeclaredStorageIndexes,
} from "../../plugins/storage-indexes.js";
import { declaredAccessToCapabilities } from "../../plugins/types.js";
import type { DeclaredAccess } from "../../plugins/types.js";
import { assertSafeArtifactUrl, fetchRegistryArtifactUrl } from "../../registry/artifact-fetch.js";
import {
	canonicalCapabilitiesForDriftCheck,
	coerceRegistryConfig,
	parseDurationSeconds,
	releaseExemptFromMinimumAge,
	validateAggregatorUrl,
} from "../../registry/config.js";
import { makeRegistryPluginId } from "../../registry/plugin-id.js";
import type { RegistryConfigInput } from "../../registry/types.js";
import { EmDashStorageError } from "../../storage/types.js";
import type { Storage } from "../../storage/types.js";
import type { ApiResult } from "../types.js";
import {
	deleteBundleFromR2,
	diffCapabilities,
	diffRouteVisibility,
	loadBundleFromR2,
	storeBundleInR2,
} from "./marketplace.js";

export { assertSafeArtifactUrl } from "../../registry/artifact-fetch.js";

const RELEASE_EXTENSION_NSID = "com.emdashcms.experimental.package.releaseExtension";

export function enforcedAccessEqual(a: DeclaredAccess, b: DeclaredAccess): boolean {
	const aa = declaredAccessToCapabilities(a);
	const bb = declaredAccessToCapabilities(b);
	return (
		JSON.stringify(aa.capabilities.toSorted()) === JSON.stringify(bb.capabilities.toSorted()) &&
		JSON.stringify(aa.allowedHosts.toSorted()) === JSON.stringify(bb.allowedHosts.toSorted())
	);
}

export interface RegistryInstallInput {
	did: string;
	slug: string;
	version?: string;
	acknowledgedDeclaredAccess?: unknown;
	acknowledgedMcpTools?: unknown;
}

export interface RegistryInstallResult {
	pluginId: string;
	publisherDid: string;
	slug: string;
	version: string;
	capabilities: string[];
}

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Uint8Array is a valid BufferSource at runtime
	const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
	const arr = new Uint8Array(buf);
	return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

const MULTIHASH_SHA256_CODE = 0x12;
const MULTIHASH_SHA256_LENGTH = 0x20;

async function sha256MultibaseMultihash(bytes: Uint8Array): Promise<string> {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Uint8Array is a valid BufferSource at runtime
	const digestBuf = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
	const digest = new Uint8Array(digestBuf);
	const multihash = new Uint8Array(2 + digest.length);
	multihash[0] = MULTIHASH_SHA256_CODE;
	multihash[1] = MULTIHASH_SHA256_LENGTH;
	multihash.set(digest, 2);
	const { toBase32 } = await import("@atcute/multibase");
	return `b${toBase32(multihash)}`;
}

export async function verifyChecksum(bytes: Uint8Array, checksum: string): Promise<boolean> {
	if (SHA256_HEX_PATTERN.test(checksum)) {
		const actual = await sha256Hex(bytes);
		return checksum.toLowerCase() === actual;
	}

	if (checksum.length === 56 && checksum.startsWith("b")) {
		const actual = await sha256MultibaseMultihash(bytes);
		return actual.toLowerCase() === checksum.toLowerCase();
	}

	return false;
}

const MAX_ARTIFACT_BYTES = 512 * 1024;

const MAX_REDIRECTS = 5;

const ARTIFACT_FETCH_TIMEOUT_MS = 15_000;

const ARTIFACT_TOTAL_BUDGET_MS = 45_000;

const MAX_MIRRORS = 16;

const AGGREGATOR_REQUEST_TIMEOUT_MS = 15_000;

const AGGREGATOR_TOTAL_BUDGET_MS = 30_000;

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

async function fetchWithLimits(initialUrl: string, totalDeadline: number): Promise<Uint8Array> {
	const now = Date.now();
	const remaining = Math.max(0, totalDeadline - now);
	if (remaining === 0) {
		throw new Error("Artifact download budget exhausted");
	}
	const perUrlTimeout = Math.min(ARTIFACT_FETCH_TIMEOUT_MS, remaining);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), perUrlTimeout);
	try {
		let current = new URL(initialUrl);
		let response: Response;
		for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
			response = await fetchRegistryArtifactUrl(current.href, {
				signal: controller.signal,
				maxResponseBytes: MAX_ARTIFACT_BYTES,
			});
			if (response.status < 300 || response.status >= 400) break;
			const location = response.headers.get("location");
			if (!location) break;
			if (hop === MAX_REDIRECTS) {
				throw new Error(`Too many redirects fetching artifact (>${MAX_REDIRECTS})`);
			}
			current = new URL(location, current);
		}
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- response is assigned in the first loop iteration
		const finalResponse = response!;
		if (!finalResponse.ok) {
			throw new Error(`HTTP ${finalResponse.status}`);
		}

		const lengthHeader = finalResponse.headers.get("content-length");
		if (lengthHeader) {
			const declared = Number(lengthHeader);
			if (Number.isFinite(declared) && declared > MAX_ARTIFACT_BYTES) {
				throw new Error(
					`Artifact too large (declared ${declared} bytes, limit ${MAX_ARTIFACT_BYTES})`,
				);
			}
		}

		const body = finalResponse.body;
		if (!body) {
			const buf = new Uint8Array(await finalResponse.arrayBuffer());
			if (buf.byteLength > MAX_ARTIFACT_BYTES) {
				throw new Error(`Artifact too large (limit ${MAX_ARTIFACT_BYTES} bytes)`);
			}
			return buf;
		}

		const reader = body.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > MAX_ARTIFACT_BYTES) {
				try {
					await reader.cancel();
				} catch {}
				throw new Error(`Artifact too large (limit ${MAX_ARTIFACT_BYTES} bytes)`);
			}
			chunks.push(value);
		}

		const out = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			out.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return out;
	} finally {
		clearTimeout(timer);
	}
}

function redactUrlForError(raw: string): string {
	try {
		const u = new URL(raw);
		return `${u.origin}${u.pathname}`;
	} catch {
		return "<malformed url>";
	}
}

async function fetchArtifact(mirrors: string[], declaredUrl: string): Promise<Uint8Array> {
	const clampedMirrors = mirrors.slice(0, MAX_MIRRORS);
	const urls = [...clampedMirrors, declaredUrl];
	const clientErrors: string[] = [];

	const totalDeadline = Date.now() + ARTIFACT_TOTAL_BUDGET_MS;

	for (const url of urls) {
		if (Date.now() >= totalDeadline) {
			clientErrors.push("(total artifact download budget exhausted)");
			break;
		}
		try {
			return await fetchWithLimits(url, totalDeadline);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(`[registry-install] Artifact fetch failed from ${url}:`, message);
			clientErrors.push(`${redactUrlForError(url)}: ${message}`);
		}
	}

	throw new Error(
		`Failed to download artifact from any source. Tried:\n  ${clientErrors.join("\n  ")}`,
	);
}

interface EnvIncompatibleError {
	code: "ENV_INCOMPATIBLE";
	message: string;
	details: { requires: Record<string, string>; host: HostEnv };
}

export function assertEnvCompatible(
	requires: unknown,
	hostEnv: HostEnv,
): EnvIncompatibleError | null {
	for (const skipped of findSkippedEnvConstraints(requires, hostEnv)) {
		console.warn(
			`[registry] env compatibility constraint skipped: ${skipped.key} requires ${skipped.required} but host version is ${skipped.reason}`,
		);
	}
	const mismatches = checkEnvCompatibility(requires, hostEnv);
	if (mismatches.length === 0) return null;
	const guarded: Record<string, string> = {};
	for (const m of mismatches) guarded[m.key] = m.required;
	const summary = mismatches
		.map((m) => `${m.key} requires ${m.required} but host is ${m.host}`)
		.join("; ");
	return {
		code: "ENV_INCOMPATIBLE",
		message: `This release is not compatible with the current environment: ${summary}.`,
		details: { requires: guarded, host: hostEnv },
	};
}

export async function handleRegistryInstall(
	db: Kysely<Database>,
	storage: Storage | null,
	sandboxRunner: SandboxRunner | null,
	registryConfigInput: RegistryConfigInput | undefined,
	input: RegistryInstallInput,
	opts?: { configuredPluginIds?: Set<string>; hostEnv?: HostEnv },
): Promise<ApiResult<RegistryInstallResult>> {
	const registryConfig = coerceRegistryConfig(registryConfigInput);
	if (!registryConfig) {
		return {
			success: false,
			error: {
				code: "REGISTRY_NOT_CONFIGURED",
				message: "Registry is not configured",
			},
		};
	}

	if (!storage) {
		return {
			success: false,
			error: {
				code: "STORAGE_NOT_CONFIGURED",
				message: "Storage is required for registry plugin installation",
			},
		};
	}

	if (!sandboxRunner || !sandboxRunner.isAvailable()) {
		return {
			success: false,
			error: {
				code: "SANDBOX_NOT_AVAILABLE",
				message: "Sandbox runner is required for registry plugins",
			},
		};
	}

	try {
		validateAggregatorUrl(registryConfig.aggregatorUrl);
	} catch (err) {
		return {
			success: false,
			error: {
				code: "REGISTRY_NOT_CONFIGURED",
				message: err instanceof Error ? err.message : "Invalid aggregator URL",
			},
		};
	}

	const { did, slug, version: requestedVersion } = input;

	const { DiscoveryClient, registryLabelerPolicy } =
		await import("@emdash-cms/registry-client/discovery");

	const aggregatorDeadline = Date.now() + AGGREGATOR_TOTAL_BUDGET_MS;
	const discovery = new DiscoveryClient({
		aggregatorUrl: registryConfig.aggregatorUrl,
		acceptLabelers: registryConfig.acceptLabelers,
		labelerPolicy: registryLabelerPolicy(registryConfig.acceptLabelers),
		fetch: timedFetch(aggregatorDeadline),
	});

	if (!did.startsWith("did:") || did.split(":").length < 3) {
		return {
			success: false,
			error: {
				code: "INVALID_DID",
				message: "DID must be a valid atproto DID (e.g. did:plc:abc123)",
			},
		};
	}

	try {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated above
		const publisherDid = did as Did;
		const packageView = await discovery.getPackage({
			did: publisherDid,
			slug,
		});

		const MAX_LIST_PAGES = 20;
		const latestRelease = await (async () => {
			if (!requestedVersion) {
				return discovery.getLatestRelease({
					did: publisherDid,
					package: slug,
				});
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
					if (r.version === requestedVersion) return r;
				}
				if (!result.cursor) break;
				cursor = result.cursor;
			}
			return undefined;
		})();
		const releaseView = latestRelease;

		if (!releaseView) {
			return {
				success: false,
				error: {
					code: "NO_RELEASE",
					message: requestedVersion
						? `Version ${requestedVersion} not found for ${publisherDid}/${slug}`
						: `No installable release found for ${publisherDid}/${slug}`,
				},
			};
		}

		const signedRelease = releaseView.release;
		if (packageView.did !== publisherDid || packageView.slug !== slug) {
			return {
				success: false,
				error: {
					code: "AGGREGATOR_IDENTITY_MISMATCH",
					message: "Aggregator returned a package view for a different publisher or slug.",
				},
			};
		}
		if (
			releaseView.did !== publisherDid ||
			releaseView.package !== slug ||
			signedRelease?.package !== slug ||
			(requestedVersion !== undefined && releaseView.version !== requestedVersion) ||
			signedRelease?.version !== releaseView.version
		) {
			return {
				success: false,
				error: {
					code: "AGGREGATOR_IDENTITY_MISMATCH",
					message:
						"Aggregator returned a release view that does not match the requested package or version.",
				},
			};
		}

		const version = releaseView.version;
		if (evaluateRegistryReleaseWithdrawal(releaseView, discovery.labelerPolicy).withdrawn) {
			return {
				success: false,
				error: {
					code: "RELEASE_YANKED",
					message: "This release has been withdrawn",
				},
			};
		}

		if (opts?.hostEnv) {
			const envError = assertEnvCompatible(releaseView.release?.requires, opts.hostEnv);
			if (envError) return { success: false, error: envError };
		}

		const minimumReleaseAge = registryConfig.policy?.minimumReleaseAge;
		let minimumReleaseAgeSeconds = 0;
		if (minimumReleaseAge !== undefined) {
			try {
				minimumReleaseAgeSeconds = parseDurationSeconds(minimumReleaseAge);
			} catch (err) {
				return {
					success: false,
					error: {
						code: "REGISTRY_POLICY_INVALID",
						message:
							err instanceof Error
								? err.message
								: "Invalid minimumReleaseAge value in registry config",
					},
				};
			}
		}
		if (minimumReleaseAgeSeconds > 0) {
			const exclude = registryConfig.policy?.minimumReleaseAgeExclude?.map((e) =>
				e.trim().toLowerCase(),
			);
			const exempt = releaseExemptFromMinimumAge(exclude, publisherDid, slug);
			if (!exempt) {
				const indexedAt = Date.parse(releaseView.indexedAt);
				if (!Number.isFinite(indexedAt)) {
					return {
						success: false,
						error: {
							code: "RELEASE_TIMESTAMP_INVALID",
							message:
								"Release record is missing a valid indexed-at timestamp; cannot evaluate minimum release age policy.",
						},
					};
				}
				const ageSeconds = (Date.now() - indexedAt) / 1000;
				if (ageSeconds < minimumReleaseAgeSeconds) {
					const remaining = Math.ceil(minimumReleaseAgeSeconds - ageSeconds);
					return {
						success: false,
						error: {
							code: "RELEASE_TOO_NEW",
							message:
								`This release does not meet the configured minimum release age of ` +
								`${minimumReleaseAgeSeconds}s. It will be installable in ~${remaining}s.`,
						},
					};
				}
			}
		}

		const pluginId = await makeRegistryPluginId(publisherDid, slug);

		if (opts?.configuredPluginIds?.has(pluginId)) {
			return {
				success: false,
				error: {
					code: "PLUGIN_ID_CONFLICT",
					message: "A configured plugin with the same derived id already exists",
				},
			};
		}

		const stateRepo = new PluginStateRepository(db);
		const existing = await stateRepo.get(pluginId);
		if (existing) {
			if (existing.source === "registry") {
				return {
					success: false,
					error: {
						code: "ALREADY_INSTALLED",
						message: `Plugin ${publisherDid}/${slug} is already installed`,
					},
				};
			}
			return {
				success: false,
				error: {
					code: "PLUGIN_ID_COLLISION",
					message:
						`A non-registry plugin already exists at the derived id ${pluginId}. ` +
						"Uninstall it before installing this registry plugin.",
				},
			};
		}

		const release = releaseView.release;
		const declaredUrl = release?.artifacts?.package?.url;
		const declaredChecksum = release?.artifacts?.package?.checksum;

		if (!declaredUrl || !declaredChecksum) {
			return {
				success: false,
				error: {
					code: "INVALID_RELEASE",
					message: "Release record is missing artifact url or checksum",
				},
			};
		}

		const mirrors = releaseView.mirrors ?? [];
		const artifactBytes = await fetchArtifact(mirrors, declaredUrl);

		const checksumOk = await verifyChecksum(artifactBytes, declaredChecksum);
		if (!checksumOk) {
			return {
				success: false,
				error: {
					code: "CHECKSUM_MISMATCH",
					message:
						"Artifact bytes do not match the release record's checksum, or the checksum encoding is unsupported.",
				},
			};
		}

		let bundle: PluginBundle;
		try {
			bundle = await extractBundle(artifactBytes);
		} catch (err) {
			return {
				success: false,
				error: {
					code: "INVALID_BUNDLE",
					message: err instanceof Error ? err.message : "Failed to extract plugin bundle",
				},
			};
		}

		if (bundle.manifest.version !== version) {
			return {
				success: false,
				error: {
					code: "MANIFEST_VERSION_MISMATCH",
					message: `Bundle manifest version (${bundle.manifest.version}) does not match release version (${version})`,
				},
			};
		}

		if (bundle.manifest.id !== slug) {
			return {
				success: false,
				error: {
					code: "MANIFEST_ID_MISMATCH",
					message: `Bundle manifest id (${bundle.manifest.id}) does not match registry slug (${slug})`,
				},
			};
		}

		bundle.manifest = { ...bundle.manifest, id: pluginId };

		const recordExt =
			// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- extensions is the lexicon's open `unknown` map; narrow to read our own extension
			(release?.extensions as Record<string, { declaredAccess?: DeclaredAccess }> | undefined)?.[
				RELEASE_EXTENSION_NSID
			];
		if (
			!enforcedAccessEqual(recordExt?.declaredAccess ?? {}, bundle.manifest.declaredAccess ?? {})
		) {
			return {
				success: false,
				error: {
					code: "DECLARED_ACCESS_DRIFT",
					message:
						"The plugin bundle declares different permissions than its published record. Installation refused.",
				},
			};
		}

		const actualCapabilities = canonicalCapabilitiesForDriftCheck(bundle.manifest.capabilities);
		if (actualCapabilities.length > 0) {
			if (input.acknowledgedDeclaredAccess === undefined) {
				return {
					success: false,
					error: {
						code: "DECLARED_ACCESS_REQUIRED",
						message:
							"This plugin declares capabilities that require consent. Re-open the install dialog to review and acknowledge them.",
					},
				};
			}
			const acknowledged = canonicalCapabilitiesForDriftCheck(input.acknowledgedDeclaredAccess);
			if (
				acknowledged.length !== actualCapabilities.length ||
				acknowledged.some((cap, i) => cap !== actualCapabilities[i])
			) {
				return {
					success: false,
					error: {
						code: "DECLARED_ACCESS_DRIFT",
						message:
							"Plugin manifest has changed since you consented. Re-open the install dialog to review the new permissions.",
					},
				};
			}
		}

		const actualMcpTools = (bundle.manifest.mcp?.tools ?? []).map(
			({ inputSchema: _, outputSchema: __, ...tool }) => tool,
		);
		if (actualMcpTools.length > 0) {
			if (JSON.stringify(input.acknowledgedMcpTools) !== JSON.stringify(actualMcpTools)) {
				return {
					success: false,
					error: {
						code: "MCP_TOOL_CONSENT_REQUIRED",
						message: "Plugin MCP tools require explicit consent",
						details: { mcpTools: actualMcpTools },
					},
				};
			}
		}

		await storeBundleInR2(storage, pluginId, version, bundle, "registry");

		const profile = packageView.profile;
		try {
			await stateRepo.upsert(pluginId, version, "active", {
				source: "registry",
				displayName: profile?.name ?? slug,
				description: profile?.description ?? undefined,
				registryPublisherDid: publisherDid,
				registrySlug: slug,
			});
		} catch (stateErr) {
			let lostRace = false;
			try {
				const winner = await stateRepo.get(pluginId);
				lostRace = winner !== undefined && winner !== null;
			} catch (probeErr) {
				console.warn(
					`[registry-install] Failed to probe state row for ${pluginId} after state-write failure; treating as orphan:`,
					probeErr,
				);
			}
			if (!lostRace) {
				try {
					await deleteBundleFromR2(storage, pluginId, version, "registry");
				} catch (cleanupErr) {
					console.warn(
						`[registry-install] Failed to clean up R2 bundle for ${pluginId}@${version} after state-row write failure:`,
						cleanupErr,
					);
				}
			}
			throw stateErr;
		}

		await syncDeclaredStorageIndexes(db, [bundle.manifest]);

		return {
			success: true,
			data: {
				pluginId,
				publisherDid,
				slug,
				version,
				capabilities: bundle.manifest.capabilities,
			},
		};
	} catch (err) {
		if (err instanceof ClientValidationError) {
			return {
				success: false,
				error: {
					code: "AGGREGATOR_RESPONSE_INVALID",
					message: `Aggregator returned a response that does not conform to its lexicon (${err.target})`,
				},
			};
		}
		if (err instanceof ClientResponseError) {
			if (err.error === "ListingUnavailable") {
				return {
					success: false,
					error: {
						code: "LISTING_UNAVAILABLE",
						message: "This plugin is unavailable under the active registry policy",
					},
				};
			}
			return {
				success: false,
				error: {
					code: err.status === 404 ? "AGGREGATOR_NOT_FOUND" : "AGGREGATOR_HTTP_ERROR",
					message: `Aggregator returned ${err.status}: ${err.error}`,
				},
			};
		}
		if (err instanceof EmDashStorageError) {
			return {
				success: false,
				error: {
					code: err.code ?? "STORAGE_ERROR",
					message: "Storage error while installing plugin",
				},
			};
		}
		console.error("[registry-install] Failed:", err);
		return {
			success: false,
			error: {
				code: "INSTALL_FAILED",
				message: err instanceof Error ? err.message : "Failed to install plugin from registry",
			},
		};
	}
}

export interface RegistryUninstallResult {
	pluginId: string;
	dataDeleted: boolean;
}

export async function handleRegistryUninstall(
	db: Kysely<Database>,
	storage: Storage | null,
	pluginId: string,
	opts?: { deleteData?: boolean },
): Promise<ApiResult<RegistryUninstallResult>> {
	try {
		const stateRepo = new PluginStateRepository(db);
		const existing = await stateRepo.get(pluginId);
		if (!existing || existing.source !== "registry") {
			return {
				success: false,
				error: {
					code: "NOT_FOUND",
					message: `No registry plugin found: ${pluginId}`,
				},
			};
		}

		const version = existing.version;

		let dataDeleted = false;
		if (opts?.deleteData) {
			await db.deleteFrom("_plugin_storage").where("plugin_id", "=", pluginId).execute();
			dataDeleted = true;
		}

		if (storage) {
			await deleteBundleFromR2(storage, pluginId, version, "registry");
		}

		try {
			await removeAllPluginIndexes(db, pluginId);
		} catch {}

		await stateRepo.delete(pluginId);

		return { success: true, data: { pluginId, dataDeleted } };
	} catch (err) {
		console.error("[registry-uninstall] Failed:", err);
		return {
			success: false,
			error: {
				code: "UNINSTALL_FAILED",
				message: "Failed to uninstall plugin",
			},
		};
	}
}

export interface RegistryUpdateResult {
	pluginId: string;
	oldVersion: string;
	newVersion: string;
	capabilityChanges: { added: string[]; removed: string[] };
	routeVisibilityChanges?: { newlyPublic: string[] };
}

export async function handleRegistryUpdate(
	db: Kysely<Database>,
	storage: Storage | null,
	sandboxRunner: SandboxRunner | null,
	registryConfigInput: RegistryConfigInput | undefined,
	pluginId: string,
	opts?: {
		version?: string;
		confirmCapabilityChanges?: boolean;
		confirmRouteVisibilityChanges?: boolean;
		confirmMcpTools?: boolean;
		hostEnv?: HostEnv;
	},
): Promise<ApiResult<RegistryUpdateResult>> {
	const registryConfig = coerceRegistryConfig(registryConfigInput);
	if (!registryConfig) {
		return {
			success: false,
			error: { code: "REGISTRY_NOT_CONFIGURED", message: "Registry is not configured" },
		};
	}
	if (!storage) {
		return {
			success: false,
			error: {
				code: "STORAGE_NOT_CONFIGURED",
				message: "Storage is required for registry plugin updates",
			},
		};
	}
	if (!sandboxRunner || !sandboxRunner.isAvailable()) {
		return {
			success: false,
			error: { code: "SANDBOX_NOT_AVAILABLE", message: "Sandbox runner is required" },
		};
	}
	try {
		validateAggregatorUrl(registryConfig.aggregatorUrl);
	} catch (err) {
		return {
			success: false,
			error: {
				code: "REGISTRY_NOT_CONFIGURED",
				message: err instanceof Error ? err.message : "Invalid aggregator URL",
			},
		};
	}

	try {
		const stateRepo = new PluginStateRepository(db);
		const existing = await stateRepo.get(pluginId);
		if (!existing || existing.source !== "registry") {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: `No registry plugin found: ${pluginId}` },
			};
		}
		if (!existing.registryPublisherDid || !existing.registrySlug) {
			return {
				success: false,
				error: {
					code: "INVALID_STATE",
					message: `Registry plugin ${pluginId} is missing publisher DID or slug in state`,
				},
			};
		}
		const oldVersion = existing.version;
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- existing.registryPublisherDid is a DID string written by the install handler
		const publisherDid = existing.registryPublisherDid as Did;
		const slug = existing.registrySlug;

		const { DiscoveryClient, registryLabelerPolicy } =
			await import("@emdash-cms/registry-client/discovery");
		const aggregatorDeadline = Date.now() + AGGREGATOR_TOTAL_BUDGET_MS;
		const discovery = new DiscoveryClient({
			aggregatorUrl: registryConfig.aggregatorUrl,
			acceptLabelers: registryConfig.acceptLabelers,
			labelerPolicy: registryLabelerPolicy(registryConfig.acceptLabelers),
			fetch: timedFetch(aggregatorDeadline),
		});

		const MAX_LIST_PAGES = 20;
		const releaseView = await (async () => {
			if (!opts?.version) {
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
					if (r.version === opts.version) return r;
				}
				if (!result.cursor) break;
				cursor = result.cursor;
			}
			return undefined;
		})();

		if (!releaseView) {
			return {
				success: false,
				error: {
					code: "NO_VERSION",
					message: opts?.version
						? `Version ${opts.version} not found for ${publisherDid}/${slug}`
						: `No installable release found for ${publisherDid}/${slug}`,
				},
			};
		}

		const signedRelease = releaseView.release;
		if (
			releaseView.did !== publisherDid ||
			releaseView.package !== slug ||
			signedRelease?.package !== slug ||
			(opts?.version !== undefined && releaseView.version !== opts.version) ||
			signedRelease?.version !== releaseView.version
		) {
			return {
				success: false,
				error: {
					code: "AGGREGATOR_IDENTITY_MISMATCH",
					message:
						"Aggregator returned a release view that does not match the requested package or version.",
				},
			};
		}

		const newVersion = releaseView.version;
		if (evaluateRegistryReleaseWithdrawal(releaseView, discovery.labelerPolicy).withdrawn) {
			return {
				success: false,
				error: { code: "YANKED", message: "Release has been withdrawn" },
			};
		}
		if (newVersion === oldVersion) {
			return {
				success: false,
				error: {
					code: "ALREADY_UP_TO_DATE",
					message: "Plugin is already at the requested version",
				},
			};
		}

		if (opts?.hostEnv) {
			const envError = assertEnvCompatible(signedRelease.requires, opts.hostEnv);
			if (envError) return { success: false, error: envError };
		}

		const declaredUrl = signedRelease.artifacts?.package?.url;
		const declaredChecksum = signedRelease.artifacts?.package?.checksum;
		if (!declaredUrl || !declaredChecksum) {
			return {
				success: false,
				error: {
					code: "INVALID_RELEASE",
					message: "Release record is missing artifact url or checksum",
				},
			};
		}

		await assertSafeArtifactUrl(declaredUrl);
		const rawMirrors = releaseView.mirrors ?? [];
		const mirrors = rawMirrors.slice(0, MAX_MIRRORS);
		for (const mirror of mirrors) {
			await assertSafeArtifactUrl(mirror);
		}

		const artifactBytes = await fetchArtifact(mirrors, declaredUrl);
		if (!(await verifyChecksum(artifactBytes, declaredChecksum))) {
			return {
				success: false,
				error: {
					code: "CHECKSUM_MISMATCH",
					message: "Artifact bytes do not match the release's published checksum",
				},
			};
		}

		const bundle: PluginBundle = await extractBundle(artifactBytes);

		if (bundle.manifest.version !== newVersion) {
			return {
				success: false,
				error: {
					code: "BUNDLE_VERSION_MISMATCH",
					message: `Bundle manifest version (${bundle.manifest.version}) does not match release version (${newVersion})`,
				},
			};
		}
		if (bundle.manifest.id !== slug) {
			return {
				success: false,
				error: {
					code: "BUNDLE_IDENTITY_MISMATCH",
					message: `Bundle manifest id (${bundle.manifest.id}) does not match registry slug (${slug})`,
				},
			};
		}

		bundle.manifest = { ...bundle.manifest, id: pluginId };

		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- extensions is the lexicon's open `unknown` map; narrow to read our own extension
		const updateRecordExtensions = signedRelease?.extensions as
			| Record<string, { declaredAccess?: DeclaredAccess }>
			| undefined;
		const recordExt = updateRecordExtensions?.[RELEASE_EXTENSION_NSID];
		if (
			!enforcedAccessEqual(recordExt?.declaredAccess ?? {}, bundle.manifest.declaredAccess ?? {})
		) {
			return {
				success: false,
				error: {
					code: "DECLARED_ACCESS_DRIFT",
					message:
						"The plugin bundle declares different permissions than its published record. Update refused.",
				},
			};
		}

		const oldBundle = await loadBundleFromR2(storage, pluginId, oldVersion, "registry");
		const oldCaps = oldBundle?.manifest.capabilities ?? [];
		const capabilityChanges = diffCapabilities(oldCaps, bundle.manifest.capabilities);
		const hasEscalation = capabilityChanges.added.length > 0;
		if (hasEscalation && !opts?.confirmCapabilityChanges) {
			return {
				success: false,
				error: {
					code: "CAPABILITY_ESCALATION",
					message: "Plugin update requires new capabilities",
					details: { capabilityChanges },
				},
			};
		}

		const routeVisibilityChanges = diffRouteVisibility(oldBundle?.manifest, bundle.manifest);
		const hasNewPublicRoutes = routeVisibilityChanges.newlyPublic.length > 0;
		if (hasNewPublicRoutes && !opts?.confirmRouteVisibilityChanges) {
			return {
				success: false,
				error: {
					code: "ROUTE_VISIBILITY_ESCALATION",
					message: "Plugin update exposes new public (unauthenticated) routes",
					details: { routeVisibilityChanges, capabilityChanges },
				},
			};
		}

		const oldMcpTools = [...(oldBundle?.manifest.mcp?.tools ?? [])].toSorted((a, b) =>
			a.name.localeCompare(b.name),
		);
		const newMcpTools = [...(bundle.manifest.mcp?.tools ?? [])].toSorted((a, b) =>
			a.name.localeCompare(b.name),
		);
		if (JSON.stringify(oldMcpTools) !== JSON.stringify(newMcpTools) && !opts?.confirmMcpTools) {
			return {
				success: false,
				error: {
					code: "MCP_TOOL_CONSENT_REQUIRED",
					message: "Plugin update changes its MCP tools",
					details: {
						mcpTools: newMcpTools.map(({ inputSchema: _, outputSchema: __, ...tool }) => tool),
					},
				},
			};
		}

		await storeBundleInR2(storage, pluginId, newVersion, bundle, "registry");

		await stateRepo.upsert(pluginId, newVersion, "active", {
			source: "registry",
			registryPublisherDid: publisherDid,
			registrySlug: slug,
			displayName: existing.displayName ?? slug,
			description: existing.description ?? undefined,
			mcpToolsEnabled: false,
			mcpToolsConsent: null,
		});

		await syncDeclaredStorageIndexes(db, [bundle.manifest]);

		deleteBundleFromR2(storage, pluginId, oldVersion, "registry").catch(() => {});

		return {
			success: true,
			data: {
				pluginId,
				oldVersion,
				newVersion,
				capabilityChanges,
				routeVisibilityChanges: hasNewPublicRoutes ? routeVisibilityChanges : undefined,
			},
		};
	} catch (err) {
		if (err instanceof ClientValidationError) {
			return {
				success: false,
				error: {
					code: "AGGREGATOR_RESPONSE_INVALID",
					message: `Aggregator returned a response that does not conform to its lexicon (${err.target})`,
				},
			};
		}
		if (err instanceof ClientResponseError) {
			if (err.error === "ListingUnavailable") {
				return {
					success: false,
					error: {
						code: "LISTING_UNAVAILABLE",
						message: "This plugin is unavailable under the active registry policy",
					},
				};
			}
			return {
				success: false,
				error: {
					code: err.status === 404 ? "AGGREGATOR_NOT_FOUND" : "AGGREGATOR_HTTP_ERROR",
					message: `Aggregator returned ${err.status}: ${err.error}`,
				},
			};
		}
		if (err instanceof EmDashStorageError) {
			return {
				success: false,
				error: {
					code: err.code ?? "STORAGE_ERROR",
					message: "Storage error while updating plugin",
				},
			};
		}
		console.error("[registry-update] Failed:", err);
		return {
			success: false,
			error: {
				code: "UPDATE_FAILED",
				message: err instanceof Error ? err.message : "Failed to update plugin",
			},
		};
	}
}

export interface RegistryUpdateCheck {
	pluginId: string;
	installed: string;
	latest: string;
	hasUpdate: boolean;
	hasCapabilityChanges: boolean;
	hasRouteVisibilityChanges: boolean;
}

export async function handleRegistryUpdateCheck(
	db: Kysely<Database>,
	registryConfigInput: RegistryConfigInput | undefined,
): Promise<ApiResult<{ items: RegistryUpdateCheck[] }>> {
	const registryConfig = coerceRegistryConfig(registryConfigInput);
	if (!registryConfig) {
		return {
			success: false,
			error: { code: "REGISTRY_NOT_CONFIGURED", message: "Registry is not configured" },
		};
	}

	try {
		const stateRepo = new PluginStateRepository(db);
		const registryPlugins = await stateRepo.getRegistryPlugins();
		if (registryPlugins.length === 0) {
			return { success: true, data: { items: [] } };
		}

		const { DiscoveryClient, registryLabelerPolicy } =
			await import("@emdash-cms/registry-client/discovery");
		const aggregatorDeadline = Date.now() + AGGREGATOR_TOTAL_BUDGET_MS;
		const discovery = new DiscoveryClient({
			aggregatorUrl: registryConfig.aggregatorUrl,
			acceptLabelers: registryConfig.acceptLabelers,
			labelerPolicy: registryLabelerPolicy(registryConfig.acceptLabelers),
			fetch: timedFetch(aggregatorDeadline),
		});

		const items: RegistryUpdateCheck[] = [];
		for (const plugin of registryPlugins) {
			if (!plugin.registryPublisherDid || !plugin.registrySlug) continue;
			try {
				const releaseView = await discovery.getLatestRelease({
					// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- DID string was validated by the install handler
					did: plugin.registryPublisherDid as Did,
					package: plugin.registrySlug,
				});
				if (evaluateRegistryReleaseWithdrawal(releaseView, discovery.labelerPolicy).withdrawn) {
					continue;
				}
				const latest = releaseView.version;
				if (!latest) continue;
				const installed = plugin.version;
				items.push({
					pluginId: plugin.pluginId,
					installed,
					latest,
					hasUpdate: latest !== installed,
					hasCapabilityChanges: false,
					hasRouteVisibilityChanges: false,
				});
			} catch (err) {
				console.warn(`[registry-update-check] Skipped ${plugin.pluginId}:`, err);
			}
		}

		return { success: true, data: { items } };
	} catch (err) {
		if (err instanceof ClientValidationError) {
			return {
				success: false,
				error: {
					code: "AGGREGATOR_RESPONSE_INVALID",
					message: `Aggregator returned a response that does not conform to its lexicon (${err.target})`,
				},
			};
		}
		if (err instanceof ClientResponseError) {
			return {
				success: false,
				error: {
					code: err.status === 404 ? "AGGREGATOR_NOT_FOUND" : "AGGREGATOR_HTTP_ERROR",
					message: `Aggregator returned ${err.status}: ${err.error}`,
				},
			};
		}
		console.error("[registry-update-check] Failed:", err);
		return {
			success: false,
			error: { code: "UPDATE_CHECK_FAILED", message: "Failed to check for registry updates" },
		};
	}
}
