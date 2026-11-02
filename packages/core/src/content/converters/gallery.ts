import type { PortableTextGalleryImage } from "./types.js";

export function sanitizeGalleryImages(
	value: unknown,
	generateKey?: () => string,
): PortableTextGalleryImage[] {
	if (!Array.isArray(value)) return [];

	const images: PortableTextGalleryImage[] = [];
	for (const entry of value as unknown[]) {
		if (!isRecord(entry)) continue;
		const record = entry;
		const asset = record.asset;
		if (!isRecord(asset)) continue;
		const assetRecord = asset;

		const image: PortableTextGalleryImage = {
			_type: "image",
			_key:
				typeof record._key === "string" && record._key
					? record._key
					: generateKey
						? generateKey()
						: "",
			asset: {
				_type: "reference",
				_ref: typeof assetRecord._ref === "string" ? assetRecord._ref : "",
				...(typeof assetRecord.url === "string" && assetRecord.url ? { url: assetRecord.url } : {}),
				...(typeof assetRecord.provider === "string" && assetRecord.provider
					? { provider: assetRecord.provider }
					: {}),
			},
		};
		if (typeof record.alt === "string" && record.alt) image.alt = record.alt;
		if (typeof record.caption === "string" && record.caption) image.caption = record.caption;
		if (typeof record.width === "number") image.width = record.width;
		if (typeof record.height === "number") image.height = record.height;
		if (typeof record.focalX === "number") image.focalX = record.focalX;
		if (typeof record.focalY === "number") image.focalY = record.focalY;
		if (typeof record.blurhash === "string" && record.blurhash) image.blurhash = record.blurhash;
		if (typeof record.dominantColor === "string" && record.dominantColor)
			image.dominantColor = record.dominantColor;

		images.push(image);
	}

	return images;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
