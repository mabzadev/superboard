const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;
const WORDPRESS_IMAGE_SIZE_SUFFIX = /-\d+x\d+(?=\.[^./?#]+$)/;
const BASE_URL_EXTENSION = /^(.+)(\.[^./?#]+)$/;

export function getBaseUrl(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.origin}${parsed.pathname}`;
	} catch {
		return url.split("?")[0] || url;
	}
}

export function buildBaseUrlMap(urlMap: Record<string, string>): Map<string, string> {
	const baseMap = new Map<string, string>();
	for (const [oldUrl, newUrl] of Object.entries(urlMap)) {
		const baseUrl = getBaseUrl(oldUrl);
		baseMap.set(baseUrl, newUrl);
	}
	return baseMap;
}

export function extractMediaUrl(value: string): string {
	try {
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- shape validated below
		const parsed = JSON.parse(value) as { src?: unknown };
		if (parsed && typeof parsed.src === "string") {
			return parsed.src;
		}
	} catch {}
	return value;
}

export function findMatchingUrl(
	url: string,
	exactMap: Record<string, string>,
	baseMap: Map<string, string>,
): string | null {
	if (exactMap[url]) {
		return exactMap[url];
	}

	const baseUrl = getBaseUrl(url);
	const baseMatch = baseMap.get(baseUrl);
	if (baseMatch) {
		return baseMatch;
	}

	const wordPressImageMatch = baseMap.get(stripWordPressImageSizeSuffix(baseUrl));
	if (wordPressImageMatch) {
		return wordPressImageMatch;
	}

	return null;
}

export interface PortableTextBlock {
	_type: string;
	_key?: string;
	asset?: {
		_type?: string;
		_ref?: string;
		url?: string;
	};
	link?: string;
	images?: PortableTextBlock[];
	columns?: Array<{ content?: PortableTextBlock[] }>;
	[key: string]: unknown;
}

export function rewritePortableTextUrls(
	blocks: PortableTextBlock[],
	exactMap: Record<string, string>,
	baseMap: Map<string, string>,
): { changed: boolean; urlsRewritten: number } {
	let changed = false;
	let urlsRewritten = 0;

	for (const block of blocks) {
		if (block._type === "image" && block.asset?.url) {
			const newUrl = findMatchingUrl(block.asset.url, exactMap, baseMap);
			if (newUrl) {
				block.asset.url = newUrl;
				block.asset._ref = newUrl;
				changed = true;
				urlsRewritten++;
			}
		}

		if (block._type === "image" && block.link) {
			const newUrl = findMatchingUrl(block.link, exactMap, baseMap);
			if (newUrl) {
				block.link = newUrl;
				changed = true;
				urlsRewritten++;
			}
		}

		if (block._type === "gallery" && Array.isArray(block.images)) {
			const result = rewritePortableTextUrls(block.images, exactMap, baseMap);
			if (result.changed) {
				changed = true;
				urlsRewritten += result.urlsRewritten;
			}
		}

		if (block._type === "columns" && Array.isArray(block.columns)) {
			for (const column of block.columns) {
				if (Array.isArray(column.content)) {
					const result = rewritePortableTextUrls(column.content, exactMap, baseMap);
					if (result.changed) {
						changed = true;
						urlsRewritten += result.urlsRewritten;
					}
				}
			}
		}
	}

	return { changed, urlsRewritten };
}

export function rewriteStringUrls(
	value: string,
	exactMap: Record<string, string>,
	baseMap: Map<string, string>,
): { newValue: string; changed: boolean; urlsRewritten: number } {
	let newValue = value;
	let changed = false;
	let urlsRewritten = 0;

	for (const [oldUrl, newUrl] of Object.entries(exactMap)) {
		if (newValue.includes(oldUrl)) {
			newValue = newValue.split(oldUrl).join(newUrl);
			changed = true;
			urlsRewritten++;
		}
	}

	for (const [baseUrl, newUrl] of baseMap.entries()) {
		const regex = buildBaseUrlMatchRegex(baseUrl);
		const matches = newValue.match(regex);
		if (matches) {
			for (const match of matches) {
				if (!exactMap[match]) {
					newValue = newValue.split(match).join(newUrl);
					changed = true;
					urlsRewritten++;
				}
			}
		}
	}

	return { newValue, changed, urlsRewritten };
}

function escapeRegExp(string: string): string {
	return string.replace(REGEX_SPECIAL_CHARS, "\\$&");
}

function stripWordPressImageSizeSuffix(url: string): string {
	return url.replace(WORDPRESS_IMAGE_SIZE_SUFFIX, "");
}

function buildBaseUrlMatchRegex(baseUrl: string): RegExp {
	const extensionMatch = BASE_URL_EXTENSION.exec(baseUrl);
	const basePattern = extensionMatch
		? `${escapeRegExp(extensionMatch[1])}(?:-\\d+x\\d+)?${escapeRegExp(extensionMatch[2])}`
		: escapeRegExp(baseUrl);

	return new RegExp(
		`${basePattern}(\\?[^"'\\s]*)?(?=$|["'\\s<>)\\],;:!?]|\\.(?=$|["'\\s<>)\\]]))`,
		"g",
	);
}
