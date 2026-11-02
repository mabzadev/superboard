import { ClientResponseError } from "@atcute/client";
import type { Nsid } from "@atcute/lexicons";
import { safeParse } from "@atcute/lexicons/validations";
import {
	capabilitiesToDeclaredAccess,
	deriveSlugFromId,
	isDeprecatedCapability,
	isPluginSlug,
	isPluginVersion,
	normalizeCapability,
	type PluginManifest,
} from "@emdash-cms/plugin-types";
import type { Did, PublishingClient } from "@emdash-cms/registry-client";
import {
	NSID,
	PackageProfile,
	PackageRelease,
	PackageReleaseExtension,
} from "@emdash-cms/registry-lexicons";

export type PublishErrorCode =
	| "DEPRECATED_CAPABILITY"
	| "INVALID_SLUG"
	| "INVALID_VERSION"
	| "INVALID_MANIFEST"
	| "LEXICON_VALIDATION_FAILED"
	| "PROFILE_BOOTSTRAP_MISSING_FIELD"
	| "RELEASE_ALREADY_PUBLISHED";

export class PublishError extends Error {
	readonly code: PublishErrorCode;
	readonly detail: Record<string, unknown> | undefined;

	constructor(code: PublishErrorCode, message: string, detail?: Record<string, unknown>) {
		super(message);
		this.name = "PublishError";
		this.code = code;
		this.detail = detail;
	}
}

export interface PublishLogger {
	info?(message: string): void;
	success?(message: string): void;
	warn?(message: string): void;
}

export interface ProfileBootstrap {
	license?: string;
	authorName?: string;
	authorUrl?: string;
	authorEmail?: string;
	securityEmail?: string;
	securityUrl?: string;
}

export interface ProfileInput {
	license?: string;
	authors?: Array<{ name: string; url?: string; email?: string }>;
	security?: Array<{ url?: string; email?: string }>;
	name?: string;
	description?: string;
	keywords?: string[];
	sections?: Record<string, string>;
}

export interface ReleaseArtifactInput {
	url: string;
	checksum: string;
	contentType: string;
	width: number;
	height: number;
	lang?: string;
}

export interface ReleaseArtifactsInput {
	icon?: ReleaseArtifactInput;
	banner?: ReleaseArtifactInput;
	screenshots?: ReleaseArtifactInput[];
}

export interface PublishOptions {
	publisher: PublishingClient;
	did: Did;
	manifest: PluginManifest;
	checksum: string;
	url: string;
	profileInput?: ProfileInput;
	profile?: ProfileBootstrap;
	repo?: string;
	requires?: Record<string, string>;
	artifacts?: ReleaseArtifactsInput;
	allowOverwrite?: boolean;
	logger?: PublishLogger;
}

export interface PublishResult {
	profileUri: string;
	releaseUri: string;
	releaseCid: string;
	checksum: string;
	profileCreated: boolean;
	releaseOverwritten: boolean;
	slug: string;
	ignoredProfileFields: string[];
}

interface PackageProfileRecordShape {
	$type: typeof NSID.packageProfile;
	id: string;
	type: "emdash-plugin" | (string & {});
	license: string;
	authors: Array<{ name: string; url?: string; email?: string }>;
	security: Array<{ url?: string; email?: string }>;
	slug: string;
	lastUpdated: string;
	name?: string;
	description?: string;
	keywords?: string[];
	sections?: Record<string, string>;
}

interface ImageArtifact {
	url: string;
	checksum: string;
	contentType: string;
	width: number;
	height: number;
	lang?: string;
}

interface PackageReleaseRecordShape {
	$type: typeof NSID.packageRelease;
	package: string;
	version: string;
	artifacts: {
		package: {
			url: string;
			checksum: string;
			contentType?: string;
		};
		icon?: ImageArtifact;
		banner?: ImageArtifact;
		screenshots?: ImageArtifact[];
	};
	repo?: string;
	requires?: Record<string, string>;
	extensions: Record<string, unknown>;
}

interface FetchedRecord {
	uri: string;
	cid: string;
	value: unknown;
}

export async function publishRelease(options: PublishOptions): Promise<PublishResult> {
	const log = options.logger ?? {};

	const deprecated = options.manifest.capabilities.filter(isDeprecatedCapability);
	if (deprecated.length > 0) {
		throw new PublishError(
			"DEPRECATED_CAPABILITY",
			`Plugin uses deprecated capability names: ${deprecated.join(", ")}. Rename them before publishing.`,
			{ deprecated },
		);
	}

	const slug = deriveSlugFromId(options.manifest.id);
	if (!isPluginSlug(slug)) {
		throw new PublishError(
			"INVALID_SLUG",
			`Plugin id "${options.manifest.id}" produces slug "${slug}" which doesn't match the lexicon constraint /^[a-z][a-z0-9_-]*$/ (max 64 chars). Rename the plugin id.`,
			{ id: options.manifest.id, slug },
		);
	}

	if (!isPluginVersion(options.manifest.version)) {
		throw new PublishError(
			"INVALID_VERSION",
			`Plugin version "${options.manifest.version}" is not a valid semver (max 64 chars; semver build-metadata "+..." disallowed because the atproto rkey alphabet has no "+").`,
			{ version: options.manifest.version },
		);
	}

	const normalizedCaps = options.manifest.capabilities.map((c) => normalizeCapability(c));
	if (
		normalizedCaps.includes("network:request") &&
		!normalizedCaps.includes("network:request:unrestricted") &&
		options.manifest.allowedHosts.length === 0
	) {
		throw new PublishError(
			"INVALID_MANIFEST",
			"Plugin declares `network:request` capability but no `allowedHosts`. Either list specific host patterns in `allowedHosts`, or upgrade to `network:request:unrestricted` if the plugin really needs to call any host.",
			{ capabilities: normalizedCaps, allowedHosts: options.manifest.allowedHosts },
		);
	}

	const profileUri = atUri(options.did, NSID.packageProfile, slug);
	const releaseRkey = `${slug}:${options.manifest.version}`;

	const [existingProfile, existingRelease] = await Promise.all([
		getRecordOrNull(options.publisher, NSID.packageProfile, slug),
		getRecordOrNull(options.publisher, NSID.packageRelease, releaseRkey),
	]);

	if (existingRelease !== null && !options.allowOverwrite) {
		throw new PublishError(
			"RELEASE_ALREADY_PUBLISHED",
			`Release ${slug}@${options.manifest.version} is already published. ` +
				"FAIR specifies that version records are immutable; aggregators and " +
				"labellers may treat any change as a takedown event. " +
				"Pass allowOverwrite: true to overwrite anyway.",
			{ slug, version: options.manifest.version },
		);
	}
	const releaseOverwritten = existingRelease !== null;
	if (releaseOverwritten) {
		log.warn?.(
			`Overwriting existing release ${slug}@${options.manifest.version}. ` +
				"Consumers who already installed this version will keep the old bytes; " +
				"aggregators may flag the change.",
		);
	}

	const profileCreated = existingProfile === null;
	const ignoredProfileFields: string[] = [];

	const declaredAccess =
		options.manifest.declaredAccess ??
		capabilitiesToDeclaredAccess(normalizedCaps, options.manifest.allowedHosts);
	const releaseExtension = {
		$type: NSID.packageReleaseExtension,
		declaredAccess,
	};

	const releaseRecord: PackageReleaseRecordShape = {
		$type: NSID.packageRelease,
		package: slug,
		version: options.manifest.version,
		artifacts: {
			package: {
				url: options.url,
				checksum: options.checksum,
				contentType: "application/gzip",
			},
		},
		extensions: {
			[NSID.packageReleaseExtension]: releaseExtension,
		},
	};
	if (options.repo !== undefined) {
		releaseRecord.repo = options.repo;
	}
	if (options.requires !== undefined && Object.keys(options.requires).length > 0) {
		releaseRecord.requires = options.requires;
	}
	applyArtifacts(releaseRecord, options.artifacts);

	type WriteOp =
		| {
				op: "create";
				collection: typeof NSID.packageProfile;
				rkey: string;
				record: PackageProfileRecordShape;
		  }
		| {
				op: "update";
				collection: typeof NSID.packageProfile;
				rkey: string;
				record: PackageProfileRecordShape;
		  }
		| {
				op: "create";
				collection: typeof NSID.packageRelease;
				rkey: string;
				record: PackageReleaseRecordShape;
		  }
		| {
				op: "update";
				collection: typeof NSID.packageRelease;
				rkey: string;
				record: PackageReleaseRecordShape;
		  };

	const writes: WriteOp[] = [];

	const usedStructured = options.profileInput !== undefined;
	const resolvedProfile = resolveProfileInput(options);

	if (profileCreated) {
		const profileRecord = buildProfileRecord({
			slug,
			profileUri,
			profile: resolvedProfile,
		});
		writes.push({
			op: "create",
			collection: NSID.packageProfile,
			rkey: slug,
			record: profileRecord,
		});
		log.info?.(`Bootstrapping profile: ${profileUri}`);
	} else {
		ignoredProfileFields.push(
			...(usedStructured
				? listProvidedProfileInputFields(options.profileInput)
				: listProvidedProfileFields(options.profile)),
		);
		const stamped = stampLastUpdated(existingProfile.value);
		if (stamped !== null) {
			writes.push({
				op: "update",
				collection: NSID.packageProfile,
				rkey: slug,
				record: stamped,
			});
			log.info?.(`Reusing profile (bumping lastUpdated): ${profileUri}`);
		} else {
			log.warn?.(
				`Existing profile at ${profileUri} doesn't match the lexicon shape; lastUpdated not bumped.`,
			);
		}
	}

	writes.push({
		op: releaseOverwritten ? "update" : "create",
		collection: NSID.packageRelease,
		rkey: releaseRkey,
		record: releaseRecord,
	});

	for (const op of writes) {
		validateLocally(op.collection, op.record);
	}

	validateLocally(NSID.packageReleaseExtension, releaseExtension);

	const batch = await options.publisher.applyWrites({
		skipValidation: true,
		writes: writes as unknown as Parameters<typeof options.publisher.applyWrites>[0]["writes"],
	});

	const releaseOpResult = batch.results.at(-1);
	if (!releaseOpResult || (releaseOpResult.op !== "create" && releaseOpResult.op !== "update")) {
		throw new Error(
			"applyWrites returned no result for the release operation (expected create/update).",
		);
	}

	if (profileCreated) {
		log.success?.(`Created profile: ${profileUri}`);
	}

	return {
		profileUri,
		releaseUri: releaseOpResult.uri,
		releaseCid: releaseOpResult.cid,
		checksum: options.checksum,
		profileCreated,
		releaseOverwritten,
		slug,
		ignoredProfileFields,
	};
}

function atUri(did: Did, collection: string, rkey: string): string {
	return `at://${did}/${collection}/${rkey}`;
}

function applyArtifacts(
	record: PackageReleaseRecordShape,
	artifacts: ReleaseArtifactsInput | undefined,
): void {
	if (!artifacts) return;
	if (artifacts.icon) record.artifacts.icon = { ...artifacts.icon };
	if (artifacts.banner) record.artifacts.banner = { ...artifacts.banner };
	if (artifacts.screenshots && artifacts.screenshots.length > 0) {
		record.artifacts.screenshots = artifacts.screenshots.map((shot) => ({ ...shot }));
	}
}

function validateLocally(collection: string, value: unknown): void {
	const schemas: Record<string, { mainSchema: Parameters<typeof safeParse>[0] } | undefined> = {
		[NSID.packageProfile]: PackageProfile,
		[NSID.packageRelease]: PackageRelease,
		[NSID.packageReleaseExtension]: PackageReleaseExtension,
	};
	const ns = schemas[collection];
	if (!ns) return;
	const result = safeParse(ns.mainSchema, value);
	if (result.ok) return;
	throw new PublishError(
		"LEXICON_VALIDATION_FAILED",
		`Record for ${collection} did not match the lexicon. Issues: ${formatValidationIssues(result)}`,
		{ collection, issues: result },
	);
}

function formatValidationIssues(err: unknown): string {
	try {
		if (err && typeof err === "object") {
			const obj = err as { issues?: unknown; message?: unknown };
			if (obj.issues !== undefined) return JSON.stringify(obj.issues);
			if (typeof obj.message === "string") return obj.message;
			return JSON.stringify(err);
		}
		if (typeof err === "string") return err;
		return JSON.stringify(err);
	} catch {
		return Object.prototype.toString.call(err);
	}
}

async function getRecordOrNull(
	publisher: PublishingClient,
	collection: Nsid,
	rkey: string,
): Promise<FetchedRecord | null> {
	try {
		const record = await publisher.getRecord({ collection, rkey });
		return { uri: record.uri, cid: record.cid, value: record.value };
	} catch (error) {
		if (error instanceof ClientResponseError && error.error === "RecordNotFound") {
			return null;
		}
		throw error;
	}
}

function stampLastUpdated(existingValue: unknown): PackageProfileRecordShape | null {
	if (!existingValue || typeof existingValue !== "object") return null;
	const v = existingValue as Record<string, unknown>;
	if (typeof v.id !== "string") return null;
	if (typeof v.type !== "string") return null;
	if (typeof v.license !== "string") return null;
	if (!Array.isArray(v.authors)) return null;
	if (!Array.isArray(v.security)) return null;
	if (typeof v.slug !== "string") return null;
	const candidate: Record<string, unknown> = {
		$type: NSID.packageProfile,
		id: v.id,
		type: v.type,
		license: v.license,
		authors: v.authors,
		security: v.security,
		slug: v.slug,
		lastUpdated: new Date().toISOString(),
	};
	if (typeof v.name === "string") candidate.name = v.name;
	if (typeof v.description === "string") candidate.description = v.description;
	if (Array.isArray(v.keywords)) candidate.keywords = v.keywords;
	if (v.sections && typeof v.sections === "object") candidate.sections = v.sections;
	return candidate as unknown as PackageProfileRecordShape;
}

function buildProfileRecord(input: {
	slug: string;
	profileUri: string;
	profile: ProfileInput;
}): PackageProfileRecordShape {
	const profile = input.profile;
	if (!profile.license) {
		throw new PublishError(
			"PROFILE_BOOTSTRAP_MISSING_FIELD",
			"license is required on first publish (e.g. MIT). The lexicon requires a SPDX license expression for every package.",
			{ field: "license" },
		);
	}

	const security: Array<{ url?: string; email?: string }> = [];
	for (const c of profile.security ?? []) {
		const entry: { url?: string; email?: string } = {};
		if (c.email) entry.email = c.email;
		if (c.url) entry.url = c.url;
		if (entry.email || entry.url) security.push(entry);
	}
	if (security.length === 0) {
		throw new PublishError(
			"PROFILE_BOOTSTRAP_MISSING_FIELD",
			"at least one security contact with a url or email is required on first publish. Clients refuse to install packages without a security contact.",
			{ field: "security" },
		);
	}

	const authors: Array<{ name: string; url?: string; email?: string }> = [];
	for (const a of profile.authors ?? []) {
		const entry: { name: string; url?: string; email?: string } = { name: a.name };
		if (a.url) entry.url = a.url;
		if (a.email) entry.email = a.email;
		authors.push(entry);
	}
	if (authors.length === 0) authors.push({ name: "unknown" });

	const record: PackageProfileRecordShape = {
		$type: NSID.packageProfile,
		id: input.profileUri,
		type: "emdash-plugin",
		license: profile.license,
		authors,
		security,
		slug: input.slug,
		lastUpdated: new Date().toISOString(),
	};
	if (profile.name !== undefined) record.name = profile.name;
	if (profile.description !== undefined) record.description = profile.description;
	if (profile.keywords !== undefined && profile.keywords.length > 0) {
		record.keywords = profile.keywords;
	}
	if (profile.sections !== undefined && Object.keys(profile.sections).length > 0) {
		record.sections = profile.sections;
	}
	return record;
}

function resolveProfileInput(options: PublishOptions): ProfileInput {
	if (options.profileInput !== undefined) return options.profileInput;
	return profileBootstrapToInput(options.profile);
}

function profileBootstrapToInput(flat: ProfileBootstrap | undefined): ProfileInput {
	const b = flat ?? {};
	const input: ProfileInput = {};
	if (b.license !== undefined) input.license = b.license;
	if (b.authorName !== undefined || b.authorUrl !== undefined || b.authorEmail !== undefined) {
		const a: { name: string; url?: string; email?: string } = { name: b.authorName ?? "unknown" };
		if (b.authorUrl) a.url = b.authorUrl;
		if (b.authorEmail) a.email = b.authorEmail;
		input.authors = [a];
	}
	if (b.securityEmail !== undefined || b.securityUrl !== undefined) {
		const c: { url?: string; email?: string } = {};
		if (b.securityEmail) c.email = b.securityEmail;
		if (b.securityUrl) c.url = b.securityUrl;
		input.security = [c];
	}
	return input;
}

function listProvidedProfileInputFields(input: ProfileInput | undefined): string[] {
	if (!input) return [];
	const fields: string[] = [];
	if (input.license !== undefined) fields.push("license");
	if (input.name !== undefined) fields.push("name");
	if (input.description !== undefined) fields.push("description");
	if (input.keywords !== undefined && input.keywords.length > 0) fields.push("keywords");
	if (input.authors !== undefined && input.authors.length > 0) fields.push("authors");
	if (input.security !== undefined && input.security.length > 0) fields.push("security");
	if (input.sections !== undefined && Object.keys(input.sections).length > 0) {
		fields.push("sections");
	}
	return fields;
}

function listProvidedProfileFields(profile: ProfileBootstrap | undefined): string[] {
	if (!profile) return [];
	const fields: Array<keyof ProfileBootstrap> = [
		"license",
		"authorName",
		"authorUrl",
		"authorEmail",
		"securityEmail",
		"securityUrl",
	];
	return fields.filter((name) => profile[name] !== undefined);
}
