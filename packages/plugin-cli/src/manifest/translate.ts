import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { PluginCapability, PluginStorageConfig } from "@emdash-cms/plugin-types";

import type { ProfileBootstrap, ProfileInput } from "../publish/api.js";
import {
	type Manifest,
	type ManifestArtifacts,
	type ManifestAuthor,
	type ManifestSecurityContact,
	type ManifestSections,
	SECTION_KEYS,
	type SectionKey,
	sectionCapError,
} from "./schema.js";

export interface NormalisedAdmin {
	pages: Array<{ path: string; label: string; icon?: string }>;
	widgets: Array<{ id: string; title?: string; size?: "full" | "half" | "third" }>;
}

export interface NormalisedManifest {
	slug: string;
	version: string;
	publisher: string;

	license: string;
	authors: ManifestAuthor[];
	securityContacts: ManifestSecurityContact[];
	name: string | undefined;
	description: string | undefined;
	keywords: string[] | undefined;
	repo: string | undefined;

	sections?: Partial<Record<SectionKey, string>>;

	requires: Record<string, string> | undefined;

	artifacts: ManifestArtifacts | undefined;

	capabilities: PluginCapability[];
	allowedHosts: string[];
	storage: PluginStorageConfig;

	admin: NormalisedAdmin;
}

export class VersionMismatchError extends Error {
	override readonly name = "VersionMismatchError";
	readonly code: "VERSION_MISMATCH" | "VERSION_MISSING";
	readonly manifestVersion: string | undefined;
	readonly packageVersion: string | undefined;

	constructor(
		code: "VERSION_MISMATCH" | "VERSION_MISSING",
		message: string,
		manifestVersion: string | undefined,
		packageVersion: string | undefined,
	) {
		super(message);
		this.code = code;
		this.manifestVersion = manifestVersion;
		this.packageVersion = packageVersion;
	}
}

export class SectionError extends Error {
	override readonly name = "SectionError";
	readonly code: "SECTION_PATH_ESCAPE" | "SECTION_FILE_UNREADABLE" | "SECTION_TOO_LARGE";
	readonly section: SectionKey;

	constructor(
		code: "SECTION_PATH_ESCAPE" | "SECTION_FILE_UNREADABLE" | "SECTION_TOO_LARGE",
		message: string,
		section: SectionKey,
	) {
		super(message);
		this.code = code;
		this.section = section;
	}
}

export async function resolveSections(
	sections: ManifestSections | undefined,
	manifestDir: string,
): Promise<Partial<Record<SectionKey, string>> | undefined> {
	if (!sections) return undefined;
	const resolved: Partial<Record<SectionKey, string>> = {};
	for (const key of SECTION_KEYS) {
		const value = sections[key];
		if (value === undefined) continue;
		const content =
			typeof value === "string" ? value : await readSectionFile(manifestDir, value.file, key);
		const capError = sectionCapError(content);
		if (capError) {
			throw new SectionError("SECTION_TOO_LARGE", `section "${key}": ${capError}.`, key);
		}
		resolved[key] = content;
	}
	return Object.keys(resolved).length > 0 ? resolved : undefined;
}

async function readSectionFile(
	manifestDir: string,
	file: string,
	section: SectionKey,
): Promise<string> {
	const absolute = resolve(manifestDir, file);
	const rel = relative(manifestDir, absolute);
	if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(file)) {
		throw new SectionError(
			"SECTION_PATH_ESCAPE",
			`section "${section}" file path ${file} resolves outside the manifest directory.`,
			section,
		);
	}
	try {
		return await readFile(absolute, "utf8");
	} catch (error) {
		throw new SectionError(
			"SECTION_FILE_UNREADABLE",
			`section "${section}" could not read file ${file}: ${error instanceof Error ? error.message : String(error)}`,
			section,
		);
	}
}

export function resolvePluginVersion(
	manifestVersion: string | undefined,
	packageVersion: string | undefined,
): string {
	if (manifestVersion !== undefined && manifestVersion.trim() !== manifestVersion) {
		throw new VersionMismatchError(
			"VERSION_MISMATCH",
			`Plugin version in emdash-plugin.jsonc has leading or trailing whitespace (${JSON.stringify(manifestVersion)}). Trim it.`,
			manifestVersion,
			packageVersion,
		);
	}
	if (packageVersion !== undefined && packageVersion.trim() !== packageVersion) {
		throw new VersionMismatchError(
			"VERSION_MISMATCH",
			`Plugin version in package.json has leading or trailing whitespace (${JSON.stringify(packageVersion)}). Trim it.`,
			manifestVersion,
			packageVersion,
		);
	}
	if (manifestVersion !== undefined && packageVersion !== undefined) {
		if (manifestVersion !== packageVersion) {
			throw new VersionMismatchError(
				"VERSION_MISMATCH",
				`Plugin version disagrees between emdash-plugin.jsonc (${manifestVersion}) and package.json (${packageVersion}). Remove "version" from emdash-plugin.jsonc to let package.json drive it, or align both values.`,
				manifestVersion,
				packageVersion,
			);
		}
		return manifestVersion;
	}
	if (manifestVersion !== undefined) return manifestVersion;
	if (packageVersion !== undefined) return packageVersion;
	throw new VersionMismatchError(
		"VERSION_MISSING",
		'Plugin version not set. Add "version" to package.json (npm-distributed plugins) or to emdash-plugin.jsonc (registry-only plugins).',
		manifestVersion,
		packageVersion,
	);
}

export function normaliseManifest(manifest: Manifest, packageVersion?: string): NormalisedManifest {
	const authors = manifest.authors ?? (manifest.author ? [manifest.author] : []);
	const securityContacts =
		manifest.securityContacts ?? (manifest.security ? [manifest.security] : []);
	const version = resolvePluginVersion(manifest.version, packageVersion);
	return {
		slug: manifest.slug,
		version,
		publisher: manifest.publisher,
		license: manifest.license,
		authors,
		securityContacts,
		name: manifest.name,
		description: manifest.description,
		keywords: manifest.keywords,
		repo: manifest.repo,
		requires: manifest.release?.requires,
		artifacts: manifest.release?.artifacts,
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- schema-enforced narrowing
		capabilities: manifest.capabilities as PluginCapability[],
		allowedHosts: manifest.allowedHosts,
		storage: manifest.storage,
		admin: {
			pages: manifest.admin?.pages ?? [],
			widgets: manifest.admin?.widgets ?? [],
		},
	};
}

export function manifestToProfileInput(manifest: NormalisedManifest): ProfileInput {
	const input: ProfileInput = {
		license: manifest.license,
		authors: manifest.authors.map((a) => ({
			name: a.name,
			...(a.url !== undefined ? { url: a.url } : {}),
			...(a.email !== undefined ? { email: a.email } : {}),
		})),
		security: manifest.securityContacts.map((c) => ({
			...(c.url !== undefined ? { url: c.url } : {}),
			...(c.email !== undefined ? { email: c.email } : {}),
		})),
	};
	if (manifest.name !== undefined) input.name = manifest.name;
	if (manifest.description !== undefined) input.description = manifest.description;
	if (manifest.keywords !== undefined) input.keywords = manifest.keywords;
	if (manifest.sections !== undefined && Object.keys(manifest.sections).length > 0) {
		input.sections = manifest.sections;
	}
	return input;
}

export function manifestToProfileBootstrap(manifest: NormalisedManifest): ProfileBootstrap {
	const author = manifest.authors[0];
	const security = manifest.securityContacts[0];

	const profile: ProfileBootstrap = { license: manifest.license };
	if (author?.name !== undefined) profile.authorName = author.name;
	if (author?.url !== undefined) profile.authorUrl = author.url;
	if (author?.email !== undefined) profile.authorEmail = author.email;
	if (security?.email !== undefined) profile.securityEmail = security.email;
	if (security?.url !== undefined) profile.securityUrl = security.url;
	return profile;
}
