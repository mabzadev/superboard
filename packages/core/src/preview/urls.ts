import { generatePreviewToken } from "./tokens.js";

const REPEATED_SLASHES = /\/{2,}/g;

export interface GetPreviewUrlOptions {
	collection: string;
	id: string;
	secret: string;
	expiresIn?: string | number;
	baseUrl?: string;
	pathPattern?: string;
	locale?: string;
}

export async function getPreviewUrl(options: GetPreviewUrlOptions): Promise<string> {
	const {
		collection,
		id,
		secret,
		expiresIn = "1h",
		baseUrl,
		pathPattern = "/{collection}/{id}",
		locale = "",
	} = options;

	const token = await generatePreviewToken({
		contentId: `${collection}:${id}`,
		expiresIn,
		secret,
	});

	let path = pathPattern
		.replace("{collection}", collection)
		.replace("{id}", id)
		.replace("{locale}", locale);
	path = path.replace(REPEATED_SLASHES, "/");
	if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

	const url = new URL(path, baseUrl || "http://placeholder");
	url.searchParams.set("_preview", token);

	if (!baseUrl) {
		return `${url.pathname}${url.search}`;
	}

	return url.toString();
}

export function buildPreviewUrl(options: {
	path: string;
	token: string;
	baseUrl?: string;
}): string {
	const { path, token, baseUrl } = options;

	const url = new URL(path, baseUrl || "http://placeholder");
	url.searchParams.set("_preview", token);

	if (!baseUrl) {
		return `${url.pathname}${url.search}`;
	}

	return url.toString();
}
