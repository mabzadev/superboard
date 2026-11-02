export const RESPONSIVE_BREAKPOINTS = [640, 750, 828, 960, 1080, 1280, 1600, 1920];

const ABSOLUTE_HTTP_URL = /^https?:\/\//i;

export function responsiveWidths(maxWidth: number): number[] {
	const cap = maxWidth * 2;
	const widths = new Set(RESPONSIVE_BREAKPOINTS.filter((w) => w <= cap));
	widths.add(maxWidth);
	return [...widths].toSorted((a, b) => a - b);
}

export function responsiveSizes(width: number | undefined): string {
	return width ? `(min-width: ${width}px) ${width}px, 100vw` : "100vw";
}

export function toAbsoluteMediaUrl(src: string, origin: string | undefined): string {
	if (!src || !origin || !src.startsWith("/")) return src;
	try {
		const resolved = new URL(src, origin);
		if (resolved.origin !== new URL(origin).origin) return src;
		return resolved.href;
	} catch {
		return src;
	}
}

export type GetImage = (options: {
	src: string;
	width?: number;
	height?: number;
	widths?: number[];
	sizes?: string;
}) => Promise<{ src: string; srcSet?: { attribute?: string } | undefined }>;

export interface ResponsiveImage {
	src: string;
	srcset?: string;
	sizes?: string;
}

export async function buildResponsiveImage(
	getImage: GetImage,
	opts: { src: string; width?: number; height?: number },
): Promise<ResponsiveImage | null> {
	const { src, width, height } = opts;
	if (!src || !width || !height) return null;
	if (!ABSOLUTE_HTTP_URL.test(src)) return null;
	try {
		const sizes = responsiveSizes(width);
		const result = await getImage({
			src,
			width,
			height,
			widths: responsiveWidths(width),
			sizes,
		});
		if (!result.src || result.src === src) return null;
		return {
			src: result.src,
			srcset: result.srcSet?.attribute || undefined,
			sizes,
		};
	} catch {
		return null;
	}
}
