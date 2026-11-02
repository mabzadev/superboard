import { ClientResponseError } from "@atcute/client";
import { safeParse } from "@atcute/lexicons/validations";
import type { PublishingClient } from "@emdash-cms/registry-client";
import { NSID, PackageProfile } from "@emdash-cms/registry-lexicons";

export type UpdatePackageErrorCode =
	| "PACKAGE_NOT_FOUND"
	| "PACKAGE_INVALID"
	| "SLUG_MISMATCH"
	| "POSSIBLE_RENAME"
	| "INVALID_INPUT"
	| "STALE_RECORD"
	| "LEXICON_VALIDATION_FAILED";

export class UpdatePackageError extends Error {
	override readonly name = "UpdatePackageError";
	readonly code: UpdatePackageErrorCode;
	readonly detail: Record<string, unknown> | undefined;

	constructor(code: UpdatePackageErrorCode, message: string, detail?: Record<string, unknown>) {
		super(message);
		this.code = code;
		this.detail = detail;
	}
}

export interface PackageUpdateInput {
	license: string;
	authors: Array<{ name: string; url?: string; email?: string }>;
	security: Array<{ url?: string; email?: string }>;
	name?: string;
	description?: string;
	keywords?: string[];
	sections?: Record<string, string>;
}

export interface PackageFieldDiff {
	field: keyof PackageUpdateInput;
	before: unknown;
	after: unknown;
}

export interface UpdatePackageOptions {
	publisher: PublishingClient;
	slug: string;
	input: PackageUpdateInput;
	apply?: boolean;
	now?: () => Date;
}

export interface UpdatePackageResult {
	profileUri: string;
	diffs: PackageFieldDiff[];
	candidate: Record<string, unknown>;
	written: boolean;
	cid?: string;
}

const FIELD_ORDER: ReadonlyArray<keyof PackageUpdateInput> = [
	"license",
	"name",
	"description",
	"keywords",
	"authors",
	"security",
	"sections",
];

export async function updatePackage(options: UpdatePackageOptions): Promise<UpdatePackageResult> {
	const did = options.publisher.did;
	const profileUri = `at://${did}/${NSID.packageProfile}/${options.slug}`;

	const inputError = validateInput(options.input);
	if (inputError) {
		throw new UpdatePackageError("INVALID_INPUT", inputError, { slug: options.slug });
	}

	const existing = await fetchExistingProfile(options.publisher, options.slug);
	if (existing === null) {
		const siblings = await findSiblingPackageSlugs(options.publisher, options.slug);
		if (siblings.length > 0) {
			const list = siblings.map((s) => `"${s}"`).join(", ");
			throw new UpdatePackageError(
				"POSSIBLE_RENAME",
				`No package at ${profileUri}. The publisher already has package(s) at: ${list}. If you renamed the plugin in your manifest, publishing under the new slug would orphan every release under the old one — revert the slug in emdash-plugin.jsonc, or accept that a rename starts a fresh package and the old releases stay where they are.`,
				{ slug: options.slug, existingSlugs: siblings, did },
			);
		}
		throw new UpdatePackageError(
			"PACKAGE_NOT_FOUND",
			`No package record at ${profileUri}. Run \`emdash-plugin publish\` to create one before editing.`,
			{ slug: options.slug, did },
		);
	}

	const existingValue = existing.value;
	if (!isPlainObject(existingValue)) {
		throw new UpdatePackageError(
			"PACKAGE_INVALID",
			`Existing profile at ${profileUri} is not a JSON object. Refusing to overwrite an unknown shape.`,
			{ slug: options.slug },
		);
	}

	const validation = safeParse(PackageProfile.mainSchema, existingValue);
	if (!validation.ok) {
		throw new UpdatePackageError(
			"PACKAGE_INVALID",
			`Existing profile at ${profileUri} does not match the package profile lexicon. Refusing to overwrite. Fix the record directly via your PDS or contact the EmDash team.`,
			{ slug: options.slug, issues: validation },
		);
	}

	const existingSlug = typeof existingValue.slug === "string" ? existingValue.slug : options.slug;
	if (existingSlug !== options.slug) {
		throw new UpdatePackageError(
			"SLUG_MISMATCH",
			`Existing profile at ${profileUri} has slug "${existingSlug}" but the manifest's slug is "${options.slug}". The slug is the record key and cannot change after publish (it would orphan every release tied to the old slug). To rename a plugin, publish under the new slug as a fresh package.`,
			{ existingSlug, manifestSlug: options.slug },
		);
	}

	const now = (options.now ?? defaultNow)();
	const { candidate, diffs } = buildPackageCandidate({
		existing: existingValue,
		input: options.input,
		now,
	});

	if (options.apply !== true || diffs.length === 0) {
		return {
			profileUri,
			diffs,
			candidate,
			written: false,
		};
	}

	const candidateValidation = safeParse(PackageProfile.mainSchema, candidate);
	if (!candidateValidation.ok) {
		throw new UpdatePackageError(
			"LEXICON_VALIDATION_FAILED",
			`Candidate package record did not pass lexicon validation. This is usually caller-supplied input exceeding a lexicon limit (e.g. license max 256 chars, description max 140 graphemes, keywords max 5 entries, author/contact url max 1024 chars). If the input shape is well within those limits, this may indicate a lexicon regression in update-package — please report it. See \`detail.issues\` for the failed checks.`,
			{ slug: options.slug, issues: candidateValidation },
		);
	}

	let put: { uri: string; cid: string };
	try {
		put = await options.publisher.unsafePutRecord({
			collection: NSID.packageProfile,
			rkey: options.slug,
			record: candidate,
			skipValidation: true,
			swapRecord: existing.cid,
		});
	} catch (error) {
		if (error instanceof ClientResponseError && error.error === "InvalidSwap") {
			throw new UpdatePackageError(
				"STALE_RECORD",
				`The package record at ${profileUri} was modified by another writer between read and write. Re-run \`emdash-plugin update-package\` to recompute the diff against the latest state and try again.`,
				{ slug: options.slug, expectedCid: existing.cid },
			);
		}
		throw error;
	}

	return {
		profileUri,
		diffs,
		candidate,
		written: true,
		cid: put.cid,
	};
}

export function buildPackageCandidate(input: {
	existing: Record<string, unknown>;
	input: PackageUpdateInput;
	now: Date;
}): { candidate: Record<string, unknown>; diffs: PackageFieldDiff[] } {
	const next = normaliseInput(input.input);
	const diffs: PackageFieldDiff[] = [];

	const candidate: Record<string, unknown> = { ...input.existing };

	for (const field of FIELD_ORDER) {
		const before = input.existing[field];
		const after = next[field];
		if (after === undefined) {
			continue;
		}
		if (!deepEqual(before, after)) {
			candidate[field] = after;
			diffs.push({ field, before, after });
		}
	}

	if (diffs.length > 0) {
		candidate.lastUpdated = input.now.toISOString();
	}

	return { candidate, diffs };
}

function normaliseInput(
	input: PackageUpdateInput,
): Partial<Record<keyof PackageUpdateInput, unknown>> {
	const out: Partial<Record<keyof PackageUpdateInput, unknown>> = {};
	out.license = input.license;
	out.authors = input.authors.map((a) =>
		omitUndefined({ name: a.name, url: a.url, email: a.email }),
	);
	out.security = input.security.map((c) => omitUndefined({ url: c.url, email: c.email }));

	if (input.name !== undefined) out.name = input.name;
	if (input.description !== undefined) out.description = input.description;
	if (input.keywords !== undefined && input.keywords.length > 0) out.keywords = input.keywords;
	if (input.sections !== undefined && Object.keys(input.sections).length > 0) {
		out.sections = input.sections;
	}

	return out;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
	const out: Partial<T> = {};
	for (const [k, v] of Object.entries(value)) {
		if (v !== undefined) (out as Record<string, unknown>)[k] = v;
	}
	return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function defaultNow(): Date {
	return new Date();
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (typeof a !== typeof b) return false;
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!deepEqual(a[i], b[i])) return false;
		}
		return true;
	}
	if (isPlainObject(a)) {
		if (!isPlainObject(b)) return false;
		const ak = Object.keys(a);
		const bk = Object.keys(b);
		if (ak.length !== bk.length) return false;
		for (const k of ak) {
			if (!Object.hasOwn(b, k)) return false;
			if (!deepEqual(a[k], b[k])) return false;
		}
		return true;
	}
	return false;
}

async function fetchExistingProfile(
	publisher: PublishingClient,
	slug: string,
): Promise<{ uri: string; cid: string; value: unknown } | null> {
	try {
		return await publisher.getRecord({ collection: NSID.packageProfile, rkey: slug });
	} catch (error) {
		if (error instanceof ClientResponseError && error.error === "RecordNotFound") {
			return null;
		}
		throw error;
	}
}

const POSSIBLE_RENAME_MAX_SIBLINGS = 10;

async function findSiblingPackageSlugs(
	publisher: PublishingClient,
	missingSlug: string,
): Promise<string[]> {
	let page: Awaited<ReturnType<PublishingClient["listRecords"]>>;
	try {
		page = await publisher.listRecords({ collection: NSID.packageProfile, limit: 100 });
	} catch (error) {
		if (error instanceof ClientResponseError && isAuthFailure(error.error)) {
			throw error;
		}
		return [];
	}
	const siblings: string[] = [];
	for (const record of page.records) {
		const rkey = atUriRkey(record.uri);
		if (rkey && rkey !== missingSlug) siblings.push(rkey);
		if (siblings.length >= POSSIBLE_RENAME_MAX_SIBLINGS) break;
	}
	return siblings;
}

function isAuthFailure(code: string): boolean {
	return (
		code === "AuthenticationRequired" ||
		code === "AuthRequired" ||
		code === "InvalidToken" ||
		code === "ExpiredToken" ||
		code === "AccountTakedown" ||
		code === "Forbidden"
	);
}

function atUriRkey(uri: string): string | null {
	const trailing = uri.split("/").pop();
	return trailing && trailing.length > 0 ? trailing : null;
}

function validateInput(input: PackageUpdateInput): string | null {
	if (typeof input.license !== "string" || input.license.length === 0) {
		return "license must be a non-empty SPDX expression.";
	}
	if (!Array.isArray(input.authors) || input.authors.length === 0) {
		return "authors must be a non-empty array (lexicon requires at least one author).";
	}
	for (const [i, author] of input.authors.entries()) {
		if (!author || typeof author.name !== "string" || author.name.length === 0) {
			return `authors[${i}].name must be a non-empty string.`;
		}
	}
	if (!Array.isArray(input.security) || input.security.length === 0) {
		return "security must be a non-empty array (lexicon requires at least one security contact).";
	}
	for (const [i, contact] of input.security.entries()) {
		if (!contact || (!contact.url && !contact.email)) {
			return `security[${i}] must have at least one of \`url\` or \`email\`.`;
		}
	}
	return null;
}
