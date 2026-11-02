import { ssrfSafeFetch, validateExternalUrl } from "../ssrf.js";
import type {
	ImportSource,
	ImportAnalysis,
	ImportContext,
	SourceInput,
	SourceProbeResult,
	FetchOptions,
	NormalizedItem,
} from "../types.js";

const TRAILING_SLASHES = /\/+$/;
const WP_JSON_SUFFIX = /\/wp-json\/?$/;

interface WpApiDiscovery {
	name?: string;
	description?: string;
	url?: string;
	home?: string;
	gmt_offset?: number;
	timezone_string?: string;
	namespaces?: string[];
	authentication?: Record<string, unknown>;
	routes?: Record<string, unknown>;
}

export const wordpressRestSource: ImportSource = {
	id: "wordpress-rest",
	name: "WordPress Site",
	description: "Connect to a self-hosted WordPress site",
	icon: "globe",
	requiresFile: false,
	canProbe: true,

	async probe(url: string): Promise<SourceProbeResult | null> {
		try {
			const siteUrl = normalizeUrl(url);

			validateExternalUrl(siteUrl);

			const apiUrl = `${siteUrl}/wp-json/`;
			const response = await ssrfSafeFetch(apiUrl, {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(10000),
			});

			if (!response.ok) {
				const altResponse = await ssrfSafeFetch(`${siteUrl}/?rest_route=/`, {
					headers: { Accept: "application/json" },
					signal: AbortSignal.timeout(10000),
				});

				if (!altResponse.ok) {
					return null;
				}
			}

			const data: WpApiDiscovery = await response.json();

			if (!data.namespaces?.includes("wp/v2")) {
				return null;
			}

			const preview = await getPublicContentCounts(siteUrl);

			const hasAppPasswords = !!data.authentication?.["application-passwords"];

			return {
				sourceId: "wordpress-rest",
				confidence: "definite",
				detected: {
					platform: "wordpress",
					siteTitle: data.name,
					siteUrl: data.url || data.home || siteUrl,
				},
				capabilities: {
					publicContent: true,
					privateContent: false,
					customPostTypes: false,
					allMeta: false,
					mediaStream: true,
				},
				auth: hasAppPasswords
					? {
							type: "password",
							instructions:
								"To import drafts and private content, create an Application Password in WordPress → Users → Your Profile → Application Passwords",
						}
					: undefined,
				preview,
				suggestedAction: {
					type: "upload",
					instructions:
						"For a complete import including drafts, custom post types, and all metadata, export your content from WordPress (Tools → Export) and upload the file here.",
				},
			};
		} catch {
			return null;
		}
	},

	async analyze(_input: SourceInput, _context: ImportContext): Promise<ImportAnalysis> {
		throw new Error("Direct REST API import not implemented. Please upload a WXR export file.");
	},

	// eslint-disable-next-line require-yield
	async *fetchContent(_input: SourceInput, _options: FetchOptions): AsyncGenerator<NormalizedItem> {
		throw new Error("Direct REST API import not implemented. Please upload a WXR export file.");
	},
};

function normalizeUrl(url: string): string {
	let normalized = url.trim();

	if (!normalized.startsWith("http")) {
		normalized = `https://${normalized}`;
	}

	normalized = normalized.replace(TRAILING_SLASHES, "");

	normalized = normalized.replace(WP_JSON_SUFFIX, "");

	return normalized;
}

async function getPublicContentCounts(
	siteUrl: string,
): Promise<{ posts?: number; pages?: number; media?: number }> {
	const result: { posts?: number; pages?: number; media?: number } = {};

	try {
		const [postsRes, pagesRes, mediaRes] = await Promise.allSettled([
			ssrfSafeFetch(`${siteUrl}/wp-json/wp/v2/posts?per_page=1`, {
				signal: AbortSignal.timeout(5000),
			}),
			ssrfSafeFetch(`${siteUrl}/wp-json/wp/v2/pages?per_page=1`, {
				signal: AbortSignal.timeout(5000),
			}),
			ssrfSafeFetch(`${siteUrl}/wp-json/wp/v2/media?per_page=1`, {
				signal: AbortSignal.timeout(5000),
			}),
		]);

		if (postsRes.status === "fulfilled" && postsRes.value.ok) {
			const total = postsRes.value.headers.get("X-WP-Total");
			if (total) result.posts = parseInt(total, 10);
		}

		if (pagesRes.status === "fulfilled" && pagesRes.value.ok) {
			const total = pagesRes.value.headers.get("X-WP-Total");
			if (total) result.pages = parseInt(total, 10);
		}

		if (mediaRes.status === "fulfilled" && mediaRes.value.ok) {
			const total = mediaRes.value.headers.get("X-WP-Total");
			if (total) result.media = parseInt(total, 10);
		}
	} catch {}

	return result;
}
