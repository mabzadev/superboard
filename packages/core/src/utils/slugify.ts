export { slugify } from "@emdash-cms/admin/slugify";

export function decodeSlug(raw: string | undefined): string | undefined {
	return raw ? decodeURIComponent(raw) : undefined;
}
