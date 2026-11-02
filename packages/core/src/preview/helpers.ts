export function isPreviewRequest(url: URL): boolean {
	return url.searchParams.has("_preview");
}

export function getPreviewToken(url: URL): string | null {
	return url.searchParams.get("_preview");
}
