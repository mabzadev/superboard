import { lookup as dnsLookup } from "node:dns/promises";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { PluginManifest } from "@emdash-cms/plugin-types";
import { FileCredentialStore, PublishingClient } from "@emdash-cms/registry-client";
import { defineCommand } from "citty";
import consola from "consola";
import pc from "picocolors";

import { formatBytes, MAX_BUNDLE_SIZE, validateBundleSize } from "../bundle/utils.js";
import { redirectConsolaToStderr } from "../cli-output.js";
import { loadManifest, MANIFEST_FILENAME, ManifestError } from "../manifest/load.js";
import { checkPublisher, PublisherCheckError, writePublisherBack } from "../manifest/publisher.js";
import {
	manifestToProfileInput,
	normaliseManifest,
	type NormalisedManifest,
	resolveSections,
	SectionError,
} from "../manifest/translate.js";
import { sha256Multihash } from "../multihash.js";
import { resumeSession } from "../oauth.js";
import {
	PublishError,
	publishRelease,
	type ProfileInput,
	type PublishLogger,
	type ReleaseArtifactsInput,
} from "../publish/api.js";
import { ArtifactUploadError, resolveReleaseArtifacts } from "../publish/upload-artifacts.js";

const MAX_TARBALL_BYTES = 384 * 1024;

export const publishCommand = defineCommand({
	meta: {
		name: "publish",
		description:
			"Publish a sandboxed plugin release to the registry (atproto + FAIR-shaped records)",
	},
	args: {
		url: {
			type: "string",
			description: "Public URL where the tarball is hosted (artifact source-of-truth)",
			required: true,
		},
		local: {
			type: "string",
			description:
				"Optional path to a local copy of the tarball at --url. The CLI still downloads the URL (it has to compute the checksum from what consumers will fetch), but cross-checks the local bytes match. Use this to catch a stale upload before publishing.",
		},
		license: {
			type: "string",
			description:
				"(deprecated: set `license` in emdash-plugin.jsonc) SPDX license expression. Required on first publish; ignored thereafter (the existing profile wins). Overrides the manifest value when both are present.",
		},
		"author-name": {
			type: "string",
			description:
				"(deprecated: set `author`/`authors` in emdash-plugin.jsonc) Author display name (first publish only). Overrides the manifest authors when any --author-* flag is present.",
		},
		"author-url": {
			type: "string",
			description: "(deprecated: use emdash-plugin.jsonc) Author URL (first publish only)",
		},
		"author-email": {
			type: "string",
			description: "(deprecated: use emdash-plugin.jsonc) Author email (first publish only)",
		},
		"security-email": {
			type: "string",
			description:
				"(deprecated: set `security`/`securityContacts` in emdash-plugin.jsonc) Security contact email. Required on first publish; ignored thereafter. Overrides the manifest security contacts when any --security-* flag is present.",
		},
		"security-url": {
			type: "string",
			description:
				"(deprecated: use emdash-plugin.jsonc) Security contact URL (first publish only)",
		},
		manifest: {
			type: "string",
			description: `Path to emdash-plugin.jsonc, or the directory containing it. Defaults to ./${MANIFEST_FILENAME}. Pass --no-manifest (or set to "false") to disable manifest loading and rely entirely on flags.`,
		},
		"no-manifest": {
			type: "boolean",
			description:
				"Disable manifest loading and rely entirely on flags. Useful in CI where the manifest lives elsewhere or shouldn't be implicitly consumed.",
			default: false,
		},
		"allow-overwrite": {
			type: "boolean",
			description:
				"Allow overwriting an existing release at <slug>:<version>. Default refuses, since FAIR treats version records as immutable and aggregators/labellers may flag any change as a takedown event.",
			default: false,
		},
		"artifact-base-url": {
			type: "string",
			description:
				"Base URL the CLI PUTs media artifacts (icon / screenshot / banner) to. Each file is uploaded to <base>/<slug>/<version>/<filename> and that URL is recorded in the release. The target must serve the bytes back unchanged with a stable content type. Required when the manifest declares any `release.artifacts`.",
		},
		json: {
			type: "boolean",
			description:
				"Emit a single-line JSON object on stdout instead of human output. Success: {profile, release, cid, checksum, url, profileCreated, releaseOverwritten}. Failure: {error: {code, message}}. Human-readable progress goes to stderr in either mode.",
		},
	},
	async run({ args }) {
		const restoreReporters = args.json ? redirectConsolaToStderr() : null;
		let exitCode = 0;
		try {
			await runPublish(args);
		} catch (error) {
			exitCode = error instanceof CliError ? error.exitCode : 1;
			handlePublishError(error, args.json);
		} finally {
			restoreReporters?.();
		}
		if (exitCode !== 0) process.exit(exitCode);
	},
});

async function runPublish(args: PublishArgs): Promise<void> {
	const urlError = validatePublishUrl(args.url);
	if (urlError) throw new CliError(urlError, 2, "INVALID_URL");

	const stringFlagError = validateStringFlags({
		license: args.license,
		"author-name": args["author-name"],
		"author-url": args["author-url"],
		"author-email": args["author-email"],
		"security-email": args["security-email"],
		"security-url": args["security-url"],
	});
	if (stringFlagError) throw new CliError(stringFlagError, 2, "INVALID_FLAG");

	const manifestLoad = await loadManifestBootstrap(args, consola);
	const manifestProfile = manifestLoad?.profileInput ?? null;

	const credentials = new FileCredentialStore();
	const session = await credentials.current();
	if (!session) {
		throw new CliError(
			"Not logged in. Run: emdash-plugin login <handle-or-did>",
			1,
			"NOT_LOGGED_IN",
		);
	}
	consola.info(`Publishing as ${pc.bold(session.handle ?? session.did)} (${pc.dim(session.did)})`);

	if (manifestLoad?.manifest.publisher !== undefined) {
		try {
			const check = await checkPublisher({
				manifestPublisher: manifestLoad.manifest.publisher,
				sessionDid: session.did,
			});
			if (check.kind === "mismatch") {
				throw new CliError(
					`Manifest pins publisher to ${pc.bold(check.pinnedDisplay)} (${check.pinnedDid}), but the active session is ${session.did}. ` +
						`Either switch sessions (\`emdash-plugin switch ${check.pinnedDid}\`), or edit the manifest if you are transferring the plugin to a new publisher.`,
					1,
					"MANIFEST_PUBLISHER_MISMATCH",
				);
			}
		} catch (error) {
			if (error instanceof PublisherCheckError) {
				throw new CliError(error.message, 1, error.code);
			}
			throw error;
		}
	}

	consola.start(`Fetching ${args.url}...`);
	const tarballBytes = await fetchTarball(args.url);
	const checksum = sha256Multihash(tarballBytes);
	const manifest = await extractManifestFromTarball(tarballBytes);

	consola.info(`Tarball: ${formatBytes(tarballBytes.length)}`);
	consola.info(`Multihash: ${pc.dim(checksum)}`);
	consola.info(`Manifest: ${pc.bold(manifest.id)}@${manifest.version}`);

	if (args.local) {
		const localPath = resolve(args.local);
		const localBytes = await readFile(localPath);
		const localChecksum = sha256Multihash(localBytes);
		if (localChecksum !== checksum) {
			throw new CliError(
				`Local file ${localPath} does not match the bytes served at ${args.url}. Local multihash: ${localChecksum}; remote multihash: ${checksum}. Re-upload the correct tarball, or drop --local to publish whatever's at the URL.`,
				1,
				"LOCAL_CHECKSUM_MISMATCH",
			);
		}
		consola.success(`Local file at ${pc.dim(localPath)} matches the URL`);
	}

	const oauthSession = await resumeSession(session.did);
	const publisher = PublishingClient.fromHandler({
		handler: oauthSession,
		did: session.did,
		pds: session.pds,
	});

	const profileInput: ProfileInput = { ...manifestProfile };
	if (args.license !== undefined) profileInput.license = args.license;
	if (
		args["author-name"] !== undefined ||
		args["author-url"] !== undefined ||
		args["author-email"] !== undefined
	) {
		const author: { name: string; url?: string; email?: string } = {
			name: args["author-name"] ?? "unknown",
		};
		if (args["author-url"] !== undefined) author.url = args["author-url"];
		if (args["author-email"] !== undefined) author.email = args["author-email"];
		profileInput.authors = [author];
	}
	if (args["security-email"] !== undefined || args["security-url"] !== undefined) {
		const contact: { url?: string; email?: string } = {};
		if (args["security-email"] !== undefined) contact.email = args["security-email"];
		if (args["security-url"] !== undefined) contact.url = args["security-url"];
		profileInput.security = [contact];
	}

	const usedDeprecatedFlags =
		args.license !== undefined ||
		args["author-name"] !== undefined ||
		args["author-url"] !== undefined ||
		args["author-email"] !== undefined ||
		args["security-email"] !== undefined ||
		args["security-url"] !== undefined;
	if (usedDeprecatedFlags) {
		consola.warn(
			"The --license / --author-* / --security-* flags are deprecated. Declare these in emdash-plugin.jsonc instead; the flags will be removed in a future release.",
		);
	}

	const logger: PublishLogger = {
		info: (m) => consola.info(m),
		success: (m) => consola.success(m),
		warn: (m) => consola.warn(m),
	};

	const artifacts = await resolveManifestArtifacts(args, manifestLoad, logger);

	const result = await publishRelease({
		publisher,
		did: session.did,
		manifest,
		checksum,
		url: args.url,
		profileInput,
		repo: manifestLoad?.manifest.repo,
		requires: manifestLoad?.manifest.requires,
		artifacts,
		allowOverwrite: args["allow-overwrite"],
		logger,
	});

	if (manifestLoad && manifestLoad.manifest.publisher === undefined) {
		await writePublisherBack({
			manifestPath: manifestLoad.path,
			sessionDid: session.did,
			sessionHandle: session.handle ?? undefined,
			onInfo: (m) => consola.info(m),
			onWarn: (m) => consola.warn(m),
		});
	}

	if (!result.profileCreated && result.ignoredProfileFields.length > 0) {
		const fields = result.ignoredProfileFields.join(", ");
		consola.warn(
			`Ignored on subsequent publish (existing package record wins): ${fields}. To edit these on the existing package, run \`emdash-plugin update-package\` (dry-run prints the diff; pass \`--yes\` to apply).`,
		);
	}

	if (args.json) {
		process.stdout.write(
			`${JSON.stringify({
				profile: result.profileUri,
				release: result.releaseUri,
				cid: result.releaseCid,
				checksum: result.checksum,
				url: args.url,
				profileCreated: result.profileCreated,
				releaseOverwritten: result.releaseOverwritten,
			})}\n`,
		);
		return;
	}

	consola.success(`Published ${pc.bold(`${result.slug}@${manifest.version}`)}`);
	consola.info(`Release URI: ${pc.dim(result.releaseUri)}`);
	consola.info(`Profile URI: ${pc.dim(result.profileUri)}`);
	console.log();
	consola.info(
		`The aggregator will pick this up from the firehose. To verify discovery once it's indexed:`,
	);
	console.log(`  ${pc.cyan(`emdash-plugin info ${session.handle ?? session.did} ${result.slug}`)}`);
}

async function resolveManifestArtifacts(
	args: PublishArgs,
	manifestLoad: ManifestLoadOutcome | null,
	logger: PublishLogger,
): Promise<ReleaseArtifactsInput | undefined> {
	const artifacts = manifestLoad?.manifest.artifacts;
	if (!manifestLoad || !artifacts) return undefined;

	const baseUrl = args["artifact-base-url"];
	if (baseUrl === undefined || baseUrl.length === 0) {
		throw new CliError(
			"The manifest declares `release.artifacts` (icon / screenshot / banner) but no --artifact-base-url was given. Pass --artifact-base-url <url> so the CLI can upload the images and record where they're hosted.",
			2,
			"ARTIFACT_BASE_URL_REQUIRED",
		);
	}
	let parsedBase: URL;
	try {
		parsedBase = new URL(baseUrl);
	} catch {
		throw new CliError(`--artifact-base-url is not a valid URL: ${baseUrl}`, 2, "INVALID_FLAG");
	}
	if (parsedBase.protocol !== "https:") {
		throw new CliError(
			`--artifact-base-url must use https; got ${parsedBase.protocol}. Host artifacts over TLS.`,
			2,
			"INVALID_FLAG",
		);
	}

	try {
		return await resolveReleaseArtifacts({
			artifacts,
			manifestDir: dirname(manifestLoad.path),
			baseUrl,
			slug: manifestLoad.manifest.slug,
			version: manifestLoad.manifest.version,
			logger,
		});
	} catch (error) {
		if (error instanceof ArtifactUploadError) {
			throw new CliError(error.message, 1, error.code);
		}
		throw error;
	}
}

function handlePublishError(error: unknown, jsonMode: boolean): void {
	let code = "INTERNAL_ERROR";
	let message = "Internal error";
	if (error instanceof PublishError) {
		code = error.code;
		message = error.message;
		consola.error(error.message);
		if (error.code === "RELEASE_ALREADY_PUBLISHED") {
			consola.error(
				"To overwrite anyway, pass --allow-overwrite (use only when you're sure no consumers have installed this version yet).",
			);
		}
	} else if (error instanceof CliError) {
		code = error.code;
		message = error.message;
		consola.error(error.message);
	} else if (error instanceof Error) {
		message = error.message;
		consola.error(error);
	} else {
		message = String(error);
		consola.error(error);
	}
	if (jsonMode) {
		process.stdout.write(`${JSON.stringify({ error: { code, message } })}\n`);
	}
}

class CliError extends Error {
	override readonly name = "CliError";
	constructor(
		message: string,
		readonly exitCode: number,
		readonly code: string,
	) {
		super(message);
	}
}

type PublishArgs = {
	url: string;
	local?: string;
	license?: string;
	"author-name"?: string;
	"author-url"?: string;
	"author-email"?: string;
	"security-email"?: string;
	"security-url"?: string;
	manifest?: string;
	"no-manifest"?: boolean;
	"allow-overwrite"?: boolean;
	"artifact-base-url"?: string;
	json?: boolean;
};

interface ManifestLoadOutcome {
	path: string;
	manifest: NormalisedManifest;
	profileInput: ProfileInput;
}

async function loadManifestBootstrap(
	args: PublishArgs,
	log: { info(m: string): void; warn(m: string): void },
): Promise<ManifestLoadOutcome | null> {
	const optedOut =
		args["no-manifest"] === true || args.manifest === "false" || args.manifest === "";
	if (optedOut) {
		const defaultPath = `./${MANIFEST_FILENAME}`;
		try {
			await stat(defaultPath);
			log.warn(
				`Skipping manifest at ${defaultPath} (--no-manifest is set). Publisher pin and license/security defaults are NOT being applied for this publish.`,
			);
		} catch {}
		return null;
	}
	const explicit = args.manifest !== undefined && args.manifest.length > 0;
	const path = args.manifest ?? `./${MANIFEST_FILENAME}`;
	try {
		const { manifest, path: resolvedPath } = await loadManifest(path);
		const packageVersion = await readSiblingPackageVersion(dirname(resolvedPath));
		let normalised: NormalisedManifest;
		try {
			normalised = normaliseManifest(manifest, packageVersion);
		} catch (error) {
			if (error instanceof Error && "code" in error) {
				const code = (error as { code: unknown }).code;
				if (code === "VERSION_MISSING" || code === "VERSION_MISMATCH") {
					throw new CliError(error.message, 1, String(code));
				}
			}
			throw error;
		}
		try {
			normalised.sections = await resolveSections(manifest.sections, dirname(resolvedPath));
		} catch (error) {
			if (error instanceof SectionError) {
				throw new CliError(error.message, 1, error.code);
			}
			throw error;
		}
		log.info(`Loaded manifest: ${pc.dim(resolvedPath)}`);
		return {
			path: resolvedPath,
			manifest: normalised,
			profileInput: manifestToProfileInput(normalised),
		};
	} catch (error) {
		if (error instanceof ManifestError) {
			if (!explicit && error.code === "MANIFEST_NOT_FOUND") return null;
			throw new CliError(error.message, 1, error.code);
		}
		throw error;
	}
}

async function readSiblingPackageVersion(manifestDir: string): Promise<string | undefined> {
	const packageJsonPath = join(manifestDir, "package.json");
	let source: string;
	try {
		source = await readFile(packageJsonPath, "utf-8");
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			(error as { code: unknown }).code === "ENOENT"
		) {
			return undefined;
		}
		throw new CliError(
			`Failed to read package.json at ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`,
			1,
			"PACKAGE_JSON_UNREADABLE",
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch (error) {
		throw new CliError(
			`package.json at ${packageJsonPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
			1,
			"PACKAGE_JSON_INVALID",
		);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new CliError(
			`package.json at ${packageJsonPath} must be a JSON object.`,
			1,
			"PACKAGE_JSON_INVALID",
		);
	}
	const version = (parsed as { version?: unknown }).version;
	if (version !== undefined && (typeof version !== "string" || version.length === 0)) {
		throw new CliError(
			`package.json at ${packageJsonPath} has a non-string \`version\` (${JSON.stringify(version)}).`,
			1,
			"PACKAGE_JSON_INVALID",
		);
	}
	return typeof version === "string" ? version : undefined;
}

export function validatePublishUrlForTest(url: string): string | null {
	return validatePublishUrl(url);
}

function validatePublishUrl(url: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return `--url is not a valid URL: ${url}`;
	}
	if (parsed.protocol !== "https:") {
		return `--url must use https; got ${parsed.protocol}. Host the tarball over TLS.`;
	}
	const host = stripTrailingDot(stripIPv6Brackets(parsed.hostname));
	if (host.length === 0) {
		return `--url ${url} has an empty hostname after canonicalisation`;
	}
	if (
		host === "localhost" ||
		host === "127.0.0.1" ||
		host === "::1" ||
		host.endsWith(".local") ||
		isPrivateIp(host) ||
		isPrivateMappedIPv6(host) ||
		isPrivateIPv6Literal(host)
	) {
		return `--url ${url} resolves to a non-public host (${host}); consumers won't be able to install from it. Host the tarball publicly first.`;
	}
	return null;
}

function stripTrailingDot(host: string): string {
	if (host.endsWith(".")) return host.slice(0, -1);
	return host;
}

function stripIPv6Brackets(host: string): string {
	if (host.length >= 2 && host.startsWith("[") && host.endsWith("]")) {
		return host.slice(1, -1);
	}
	return host;
}

async function validateResolvedHost(host: string): Promise<string | null> {
	const stripped = stripIPv6Brackets(host);
	if (IPV4_RE.test(stripped)) return null;
	if (stripped.includes(":")) return null;
	let addresses: Array<{ address: string; family: number }>;
	try {
		addresses = await dnsLookup(stripped, { all: true, verbatim: true });
	} catch (error) {
		return `could not resolve ${stripped}: ${error instanceof Error ? error.message : String(error)}`;
	}
	for (const { address } of addresses) {
		if (
			address === "127.0.0.1" ||
			address === "::1" ||
			isPrivateIp(address) ||
			isPrivateMappedIPv6(address) ||
			isPrivateIPv6Literal(address)
		) {
			return `${stripped} resolves to non-public address ${address}`;
		}
	}
	return null;
}

const TAR_LEADING_DOT_SLASH_RE = /^\.\//;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_ULA_FC_RE = /^fc[0-9a-f]{2}(?::|$)/i;
const IPV6_ULA_FD_RE = /^fd[0-9a-f]{2}(?::|$)/i;
const IPV6_LINK_LOCAL_RE = /^fe[89ab][0-9a-f](?::|$)/i;
const IPV6_LOOPBACK_RE = /^::1$/i;
const IPV6_UNSPECIFIED_RE = /^::$/i;
const IPV6_V4_COMPAT_DOTTED_RE = /^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;
const IPV6_V4_MAPPED_DOTTED_RE = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;
const IPV6_V4_MAPPED_HEX_RE = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;
const IPV6_V4_COMPAT_HEX_RE = /^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;
const IPV6_NAT64_RE = /^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;
const IPV6_NAT64_LOCAL_RE = /^64:ff9b:1:[0-9a-f:]*:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;
const IPV6_6TO4_RE = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/i;

function isPrivateIp(host: string): boolean {
	const v4 = IPV4_RE.exec(host);
	if (v4) {
		const [, aStr, bStr] = v4;
		const a = Number(aStr);
		const b = Number(bStr);
		if (a === 0) return true;
		if (a === 10) return true;
		if (a === 100 && b >= 64 && b <= 127) return true;
		if (a === 127) return true;
		if (a === 169 && b === 254) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
	}
	if (IPV6_ULA_FC_RE.test(host) || IPV6_ULA_FD_RE.test(host)) return true;
	if (IPV6_LINK_LOCAL_RE.test(host)) return true;
	return false;
}

function isPrivateMappedIPv6(host: string): boolean {
	const dotted = IPV6_V4_MAPPED_DOTTED_RE.exec(host) ?? IPV6_V4_COMPAT_DOTTED_RE.exec(host);
	if (dotted) {
		const inner = dotted[1];
		return inner ? isPrivateIp(inner) : false;
	}
	const hex = IPV6_V4_MAPPED_HEX_RE.exec(host) ?? IPV6_V4_COMPAT_HEX_RE.exec(host);
	if (hex) {
		const v4 = decodeIPv6V4HexPair(hex[1], hex[2]);
		return v4 ? isPrivateIp(v4) : false;
	}
	return false;
}

function isPrivateIPv6Literal(host: string): boolean {
	if (IPV6_LOOPBACK_RE.test(host)) return true;
	if (IPV6_UNSPECIFIED_RE.test(host)) return true;
	if (IPV6_ULA_FC_RE.test(host)) return true;
	if (IPV6_ULA_FD_RE.test(host)) return true;
	if (IPV6_LINK_LOCAL_RE.test(host)) return true;
	const nat64 = IPV6_NAT64_RE.exec(host) ?? IPV6_NAT64_LOCAL_RE.exec(host);
	if (nat64) {
		const v4 = decodeIPv6V4HexPair(nat64[1], nat64[2]);
		if (v4 && isPrivateIp(v4)) return true;
	}
	const sixtofour = IPV6_6TO4_RE.exec(host);
	if (sixtofour) {
		const v4 = decodeIPv6V4HexPair(sixtofour[1], sixtofour[2]);
		if (v4 && isPrivateIp(v4)) return true;
	}
	return false;
}

function decodeIPv6V4HexPair(a: string | undefined, b: string | undefined): string | null {
	if (!a || !b) return null;
	const ax = Number.parseInt(a, 16);
	const bx = Number.parseInt(b, 16);
	if (!Number.isFinite(ax) || !Number.isFinite(bx)) return null;
	if (ax < 0 || ax > 0xffff || bx < 0 || bx > 0xffff) return null;
	const o1 = (ax >> 8) & 0xff;
	const o2 = ax & 0xff;
	const o3 = (bx >> 8) & 0xff;
	const o4 = bx & 0xff;
	return `${o1}.${o2}.${o3}.${o4}`;
}

function validateStringFlags(flags: Record<string, string | undefined>): string | null {
	for (const [name, value] of Object.entries(flags)) {
		if (value !== undefined && value === "") {
			return `--${name} cannot be empty`;
		}
	}
	return null;
}

function oversizedFetchError(url: string, fetched: number): string {
	return (
		`tarball at ${url} is ${formatBytes(fetched)} (gzipped), exceeding the ${formatBytes(MAX_TARBALL_BYTES)} fetch cap. ` +
		`Sandboxed plugin bundles must decompress to at most ${formatBytes(MAX_BUNDLE_SIZE)} (RFC 0001).`
	);
}

async function fetchTarball(url: string): Promise<Uint8Array> {
	const MAX_REDIRECTS = 10;
	let currentUrl = url;
	let res: Response | undefined;
	const initialDns = await validateResolvedHost(new URL(url).hostname);
	if (initialDns) {
		throw new Error(`tarball at ${url}: ${initialDns}`);
	}
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		res = await fetch(currentUrl, {
			headers: { Accept: "application/octet-stream" },
			redirect: "manual",
		});
		const status = res.status;
		const location = res.headers.get("location");
		if (location === null) break;
		const isRedirect = (status >= 300 && status < 400) || status === 0;
		if (!isRedirect) break;
		if (hop === MAX_REDIRECTS) {
			throw new Error(`tarball at ${url}: too many redirects (>${MAX_REDIRECTS})`);
		}
		const next = new URL(location, currentUrl).toString();
		const hopError = validatePublishUrl(next);
		if (hopError) {
			throw new Error(`tarball at ${url} redirected to a disallowed URL (${next}): ${hopError}`);
		}
		const dnsError = await validateResolvedHost(new URL(next).hostname);
		if (dnsError) {
			throw new Error(`tarball at ${url} redirected to a disallowed URL (${next}): ${dnsError}`);
		}
		currentUrl = next;
	}
	if (!res) {
		throw new Error(`failed to fetch ${url}: no response`);
	}
	if (!res.ok) {
		throw new Error(`failed to fetch ${url}: ${res.status} ${res.statusText}`);
	}

	const contentLength = res.headers.get("content-length");
	if (contentLength) {
		const len = Number(contentLength);
		if (Number.isFinite(len) && len > MAX_TARBALL_BYTES) {
			throw new Error(oversizedFetchError(url, len));
		}
	}

	if (!res.body) {
		const buf = await res.arrayBuffer();
		if (buf.byteLength > MAX_TARBALL_BYTES) {
			throw new Error(oversizedFetchError(url, buf.byteLength));
		}
		return new Uint8Array(buf);
	}

	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			total += value.length;
			if (total > MAX_TARBALL_BYTES) {
				await reader.cancel();
				throw new Error(oversizedFetchError(url, total));
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

export const extractManifestFromTarballForTest = extractManifestFromTarball;

async function extractManifestFromTarball(bytes: Uint8Array): Promise<PluginManifest> {
	const { unpackTar, createGzipDecoder } = await import("modern-tar");
	const source = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
	let entries;
	try {
		const decoded = source.pipeThrough(createGzipDecoder()) as ReadableStream<Uint8Array>;
		entries = await unpackTar(decoded);
	} catch (error) {
		throw new Error(
			`tarball at the URL is not a valid gzipped tar archive: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
	const fileEntries = entries
		.filter((e) => (e.header.type ?? "file") === "file")
		.map((e) => ({
			name: e.header.name.replace(TAR_LEADING_DOT_SLASH_RE, ""),
			bytes: e.data?.byteLength ?? 0,
		}));
	const sizeViolations = validateBundleSize(fileEntries);
	if (sizeViolations.length > 0) {
		throw new Error(
			`tarball at the URL violates bundle size caps:\n  - ${sizeViolations.join("\n  - ")}`,
		);
	}
	const manifestEntry = entries.find((e) => {
		const name = e.header.name;
		return name === "manifest.json" || name === "./manifest.json";
	});
	if (!manifestEntry?.data) {
		throw new Error("manifest.json not found in tarball");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(manifestEntry.data));
	} catch (error) {
		throw new Error(
			`manifest.json in the tarball is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
	return assertManifestShape(parsed);
}

function assertManifestShape(value: unknown): PluginManifest {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("manifest.json must be a JSON object");
	}
	const v = value as Record<string, unknown>;
	if (typeof v.id !== "string" || v.id.length === 0) {
		throw new Error("manifest.json: `id` must be a non-empty string");
	}
	if (typeof v.version !== "string" || v.version.length === 0) {
		throw new Error("manifest.json: `version` must be a non-empty string");
	}
	if (!Array.isArray(v.capabilities) || v.capabilities.some((c) => typeof c !== "string")) {
		throw new Error("manifest.json: `capabilities` must be an array of strings");
	}
	if (!Array.isArray(v.allowedHosts) || v.allowedHosts.some((h) => typeof h !== "string")) {
		throw new Error("manifest.json: `allowedHosts` must be an array of strings");
	}
	if (!v.storage || typeof v.storage !== "object" || Array.isArray(v.storage)) {
		throw new Error("manifest.json: `storage` must be an object");
	}
	if (!Array.isArray(v.hooks)) {
		throw new Error("manifest.json: `hooks` must be an array");
	}
	for (const [i, entry] of v.hooks.entries()) {
		if (typeof entry === "string") continue;
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			throw new Error(
				`manifest.json: \`hooks[${i}]\` must be a string or object, got ${describeJsonValue(entry)}`,
			);
		}
	}
	if (!Array.isArray(v.routes)) {
		throw new Error("manifest.json: `routes` must be an array");
	}
	for (const [i, entry] of v.routes.entries()) {
		if (typeof entry === "string") continue;
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			throw new Error(
				`manifest.json: \`routes[${i}]\` must be a string or object, got ${describeJsonValue(entry)}`,
			);
		}
	}
	if (!v.admin || typeof v.admin !== "object" || Array.isArray(v.admin)) {
		throw new Error("manifest.json: `admin` must be an object");
	}
	return v as unknown as PluginManifest;
}

function describeJsonValue(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}
