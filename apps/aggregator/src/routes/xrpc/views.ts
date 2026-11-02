import * as ComAtprotoLabelDefs from "@atcute/atproto/types/label/defs";
import { safeParse } from "@atcute/lexicons/validations";
import { type AggregatorDefs, NSID } from "@emdash-cms/registry-lexicons";

import { isPlainObject, parseSignatureMetadataCid } from "../../utils.js";

export interface PackageRow {
	did: string;
	slug: string;
	type: string;
	name: string | null;
	description: string | null;
	license: string;
	authors: string;
	security: string;
	keywords: string | null;
	sections: string | null;
	last_updated: string | null;
	latest_version: string | null;
	signature_metadata: string | null;
	verified_at: string;
	indexed_at: string | null;
	labels_json?: string;
}

export interface ReleaseRow {
	did: string;
	package: string;
	version: string;
	rkey: string;
	artifacts: string;
	requires: string | null;
	suggests: string | null;
	emdash_extension: string;
	repo_url: string | null;
	signature_metadata: string | null;
	verified_at: string;
	indexed_at: string | null;
	labels_json?: string;
}

const PACKAGE_VIEW_COLUMN_NAMES = [
	"did",
	"slug",
	"type",
	"name",
	"description",
	"license",
	"authors",
	"security",
	"keywords",
	"sections",
	"last_updated",
	"latest_version",
	"signature_metadata",
	"verified_at",
	"indexed_at",
] as const;

const RELEASE_VIEW_COLUMN_NAMES = [
	"did",
	"package",
	"version",
	"rkey",
	"artifacts",
	"requires",
	"suggests",
	"emdash_extension",
	"repo_url",
	"signature_metadata",
	"verified_at",
	"indexed_at",
] as const;

export function packageColumns(prefix = ""): string {
	return PACKAGE_VIEW_COLUMN_NAMES.map((c) => `${prefix}${c}`).join(", ");
}

export function releaseColumns(prefix = ""): string {
	return RELEASE_VIEW_COLUMN_NAMES.map((c) => `${prefix}${c}`).join(", ");
}

export function packageView(row: PackageRow): AggregatorDefs.PackageView {
	const uri = `at://${row.did}/${NSID.packageProfile}/${row.slug}` as const;
	const cid = parseSignatureMetadataCid(row.signature_metadata) ?? "";
	const view: AggregatorDefs.PackageView = {
		uri,
		cid,
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- `did` is consumer-validated at write time
		did: row.did as `did:${string}:${string}`,
		slug: row.slug,
		profile: synthesizePackageProfile(row, uri),
		indexedAt: row.indexed_at ?? row.verified_at,
		labels: parseHydratedLabels(row.labels_json ?? "[]"),
	};
	if (row.latest_version !== null) {
		view.latestVersion = row.latest_version;
	}
	return view;
}

export function releaseView(row: ReleaseRow): AggregatorDefs.ReleaseView {
	const uri = `at://${row.did}/${NSID.packageRelease}/${row.rkey}` as const;
	const cid = parseSignatureMetadataCid(row.signature_metadata) ?? "";
	return {
		uri,
		cid,
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- `did` is consumer-validated at write time
		did: row.did as `did:${string}:${string}`,
		package: row.package,
		version: row.version,
		release: synthesizePackageRelease(row),
		mirrors: [],
		indexedAt: row.indexed_at ?? row.verified_at,
		labels: parseHydratedLabels(row.labels_json ?? "[]"),
	};
}

function synthesizePackageProfile(row: PackageRow, uri: string): Record<string, unknown> {
	const profile: Record<string, unknown> = {
		$type: NSID.packageProfile,
		id: uri,
		type: row.type,
		license: row.license,
		authors: parseJsonArray(row.authors),
		security: parseJsonArray(row.security),
	};
	if (row.name !== null) profile["name"] = row.name;
	if (row.description !== null) profile["description"] = row.description;
	if (row.keywords !== null) profile["keywords"] = parseJsonArray(row.keywords);
	if (row.sections !== null) {
		const sections = parseJsonObject(row.sections);
		if (sections) profile["sections"] = sections;
	}
	if (row.last_updated !== null) profile["lastUpdated"] = row.last_updated;
	profile["slug"] = row.slug;
	return profile;
}

function synthesizePackageRelease(row: ReleaseRow): Record<string, unknown> {
	const release: Record<string, unknown> = {
		$type: NSID.packageRelease,
		package: row.package,
		version: row.version,
		artifacts: parseJsonObject(row.artifacts) ?? {},
	};
	if (row.requires !== null) {
		const requires = parseJsonObject(row.requires);
		if (requires) release["requires"] = requires;
	}
	if (row.suggests !== null) {
		const suggests = parseJsonObject(row.suggests);
		if (suggests) release["suggests"] = suggests;
	}
	if (row.repo_url !== null) release["repo"] = row.repo_url;
	const ext = parseJsonObject(row.emdash_extension);
	if (ext) {
		release["extensions"] = {
			[NSID.packageReleaseExtension]: { ...ext, $type: NSID.packageReleaseExtension },
		};
	}
	return release;
}

function parseJsonArray(json: string): unknown[] {
	try {
		const parsed: unknown = JSON.parse(json);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function parseHydratedLabels(json: string): AggregatorDefs.ReleaseView["labels"] {
	const values = parseJsonArray(json);
	const labels: AggregatorDefs.ReleaseView["labels"] = [];
	for (const value of values) {
		const parsed = safeParse(ComAtprotoLabelDefs.labelSchema, value);
		if (!parsed.ok) throw new Error("stored hydrated label failed AT Protocol validation");
		labels.push(parsed.value);
	}
	return labels;
}

function parseJsonObject(json: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(json);
		return isPlainObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
