import { imageSize } from "image-size";

import { sha256Multihash } from "../multihash.js";

export interface ArtifactRecord {
	url: string;
	checksum: string;
	contentType: string;
	width: number;
	height: number;
	lang?: string;
}

const MAX_ARTIFACT_DIMENSION = 8192;

const TYPE_TO_CONTENT_TYPE: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
};

export class ArtifactError extends Error {
	override readonly name = "ArtifactError";
	readonly code: "ARTIFACT_UNSUPPORTED" | "ARTIFACT_UNREADABLE";

	constructor(code: "ARTIFACT_UNSUPPORTED" | "ARTIFACT_UNREADABLE", message: string) {
		super(message);
		this.code = code;
	}
}

export function measureImage(bytes: Uint8Array): {
	contentType: string;
	width: number;
	height: number;
} {
	let result: { width?: number; height?: number; type?: string };
	try {
		result = imageSize(bytes);
	} catch (error) {
		throw new ArtifactError(
			"ARTIFACT_UNREADABLE",
			`Artifact is not a recognised image: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const type = result.type;
	if (type === undefined || !(type in TYPE_TO_CONTENT_TYPE)) {
		throw new ArtifactError(
			"ARTIFACT_UNSUPPORTED",
			`Artifact image format ${type ? `"${type}"` : "(unknown)"} is not supported. Use PNG, JPEG, WebP, GIF, or AVIF.`,
		);
	}
	const { width, height } = result;
	if (typeof width !== "number" || typeof height !== "number" || width < 1 || height < 1) {
		throw new ArtifactError(
			"ARTIFACT_UNSUPPORTED",
			"Artifact image has no readable pixel dimensions.",
		);
	}
	if (width > MAX_ARTIFACT_DIMENSION || height > MAX_ARTIFACT_DIMENSION) {
		throw new ArtifactError(
			"ARTIFACT_UNSUPPORTED",
			`Artifact image is ${width}x${height}px; each dimension must be <= ${MAX_ARTIFACT_DIMENSION}px.`,
		);
	}
	return { contentType: TYPE_TO_CONTENT_TYPE[type]!, width, height };
}

export function buildArtifactRecord(input: {
	bytes: Uint8Array;
	url: string;
	lang?: string;
}): ArtifactRecord {
	const { contentType, width, height } = measureImage(input.bytes);
	const record: ArtifactRecord = {
		url: input.url,
		checksum: sha256Multihash(input.bytes),
		contentType,
		width,
		height,
	};
	if (input.lang !== undefined) record.lang = input.lang;
	return record;
}
