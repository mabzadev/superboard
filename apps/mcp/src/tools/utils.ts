export type Obj = Record<string, unknown>;

export function extractPath(input: string): string {
	const trimmed = input.trim();
	try {
		const url = new URL(trimmed);
		return url.pathname.replace(/^\/+/, "");
	} catch {
		return trimmed.replace(/^\/+/, "");
	}
}

export function slugify(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 128);
	return slug || "link";
}
