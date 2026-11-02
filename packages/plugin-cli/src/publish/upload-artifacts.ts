import { readFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

import type { ManifestArtifacts, ManifestArtifactFile } from "../manifest/schema.js";
import type { ReleaseArtifactInput, ReleaseArtifactsInput } from "./api.js";
import { ArtifactError, buildArtifactRecord } from "./artifacts.js";

const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

const TRAILING_SLASHES = /\/+$/;

export interface ResolveArtifactsOptions {
	artifacts: ManifestArtifacts | undefined;
	manifestDir: string;
	baseUrl: string;
	slug: string;
	version: string;
	logger?: { info?(m: string): void; success?(m: string): void };
	upload?: ArtifactUploader;
}

export type ArtifactUploader = (input: {
	url: string;
	bytes: Uint8Array;
	contentType: string;
}) => Promise<void>;

export class ArtifactUploadError extends Error {
	override readonly name = "ArtifactUploadError";
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

export async function resolveReleaseArtifacts(
	options: ResolveArtifactsOptions,
): Promise<ReleaseArtifactsInput | undefined> {
	const { artifacts } = options;
	if (!artifacts) return undefined;
	if (!artifacts.icon && !artifacts.banner && !(artifacts.screenshots?.length ?? 0)) {
		return undefined;
	}

	const upload = options.upload ?? httpPutUploader;
	const out: ReleaseArtifactsInput = {};

	if (artifacts.icon) {
		out.icon = await resolveOne(artifacts.icon, "icon", "icon", options, upload);
	}
	if (artifacts.banner) {
		out.banner = await resolveOne(artifacts.banner, "banner", "banner", options, upload);
	}
	if (artifacts.screenshots && artifacts.screenshots.length > 0) {
		const screenshots: ReleaseArtifactInput[] = [];
		for (const [index, ref] of artifacts.screenshots.entries()) {
			screenshots.push(
				await resolveOne(
					ref,
					`screenshot ${index + 1}`,
					`screenshot-${index + 1}`,
					options,
					upload,
				),
			);
		}
		out.screenshots = screenshots;
	}

	return out;
}

async function resolveOne(
	ref: ManifestArtifactFile,
	label: string,
	slot: string,
	options: ResolveArtifactsOptions,
	upload: ArtifactUploader,
): Promise<ReleaseArtifactInput> {
	const absolute = resolveWithinManifest(options.manifestDir, ref.file, label);
	let bytes: Uint8Array;
	try {
		bytes = await readFile(absolute);
	} catch (error) {
		throw new ArtifactUploadError(
			"ARTIFACT_FILE_UNREADABLE",
			`Could not read ${label} artifact at ${ref.file}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (bytes.length > MAX_ARTIFACT_BYTES) {
		throw new ArtifactUploadError(
			"ARTIFACT_TOO_LARGE",
			`${label} artifact ${ref.file} is ${bytes.length} bytes, exceeding the ${MAX_ARTIFACT_BYTES}-byte limit.`,
		);
	}

	let record;
	try {
		record = buildArtifactRecord({
			bytes,
			url: artifactUrl(options.baseUrl, options.slug, options.version, slot, ref.file),
			lang: ref.lang,
		});
	} catch (error) {
		if (error instanceof ArtifactError) {
			throw new ArtifactUploadError(error.code, `${label} artifact: ${error.message}`);
		}
		throw error;
	}

	options.logger?.info?.(`Uploading ${label} (${record.width}x${record.height}) -> ${record.url}`);
	try {
		await upload({ url: record.url, bytes, contentType: record.contentType });
	} catch (error) {
		throw new ArtifactUploadError(
			"ARTIFACT_UPLOAD_FAILED",
			`Failed to upload ${label} artifact to ${record.url}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	options.logger?.success?.(`Uploaded ${label}`);
	return record;
}

function resolveWithinManifest(manifestDir: string, file: string, label: string): string {
	const absolute = resolve(manifestDir, file);
	const rel = relative(manifestDir, absolute);
	if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(file)) {
		throw new ArtifactUploadError(
			"ARTIFACT_PATH_ESCAPE",
			`${label} artifact path ${file} resolves outside the manifest directory.`,
		);
	}
	return absolute;
}

function artifactUrl(
	baseUrl: string,
	slug: string,
	version: string,
	slot: string,
	file: string,
): string {
	const trimmed = baseUrl.replace(TRAILING_SLASHES, "");
	const name = `${slot}-${basename(file)}`;
	return `${trimmed}/${encodeURIComponent(slug)}/${encodeURIComponent(version)}/${encodeURIComponent(name)}`;
}

const httpPutUploader: ArtifactUploader = async ({ url, bytes, contentType }) => {
	const response = await fetch(url, {
		method: "PUT",
		headers: { "Content-Type": contentType },
		body: bytes,
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText}`);
	}
};
