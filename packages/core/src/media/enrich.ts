import { normalizeMime } from "./mime.js";
import { generatePlaceholder, readDimensions } from "./placeholder.js";

export interface EnrichedImageMetadata {
	width?: number;
	height?: number;
	blurhash?: string;
	dominantColor?: string;
}

export async function enrichImageMetadata(
	bytes: Uint8Array,
	contentType: string,
	opts?: {
		knownDimensions?: { width: number; height: number };
		placeholder?: { bytes: Uint8Array; contentType: string };
	},
): Promise<EnrichedImageMetadata> {
	const normalizedContentType = normalizeMime(contentType);
	if (!normalizedContentType.startsWith("image/")) return {};

	const headerDims = readDimensions(bytes) ?? undefined;

	const recordDims = opts?.knownDimensions ?? headerDims;

	const override = opts?.placeholder;
	const placeholder = await generatePlaceholder(
		override ? override.bytes : bytes,
		override ? normalizeMime(override.contentType) : normalizedContentType,
		override ? undefined : headerDims,
	);

	return {
		width: recordDims?.width,
		height: recordDims?.height,
		blurhash: placeholder?.blurhash,
		dominantColor: placeholder?.dominantColor,
	};
}
