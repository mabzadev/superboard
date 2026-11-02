export const THUMBNAIL_MAX_DIMENSION = 64;

export function computeThumbnailSize(
	width: number,
	height: number,
): { width: number; height: number } {
	if (width <= 0 || height <= 0) {
		return { width: 1, height: 1 };
	}
	const maxDim = Math.max(width, height);
	const scale = Math.min(1, THUMBNAIL_MAX_DIMENSION / maxDim);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}
