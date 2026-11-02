const TRAILING_SLASH_RE = /\/$/;
const ABSOLUTE_URL_RE = /^https?:\/\//i;

export function buildSeoImageUrl(imageRef: string, siteUrl?: string): string {
	if (ABSOLUTE_URL_RE.test(imageRef)) {
		return imageRef;
	}

	if (imageRef.startsWith("/")) {
		return siteUrl ? `${siteUrl.replace(TRAILING_SLASH_RE, "")}${imageRef}` : imageRef;
	}

	const mediaPath = `/_emdash/api/media/file/${imageRef}`;
	return siteUrl ? `${siteUrl.replace(TRAILING_SLASH_RE, "")}${mediaPath}` : mediaPath;
}
