export function isSafeRedirect(url: string | null | undefined): url is string {
	return (
		typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")
	);
}
