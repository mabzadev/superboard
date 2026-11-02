import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { API_BASE, apiFetch, parseApiResponse, throwResponseError } from "./client.js";

export type FieldCompatibility = "compatible" | "type_mismatch" | "missing";

export interface ImportFieldDef {
	slug: string;
	label: string;
	type: string;
	required: boolean;
}

export interface CollectionSchemaStatus {
	exists: boolean;
	fieldStatus: Record<
		string,
		{
			status: FieldCompatibility;
			existingType?: string;
			requiredType: string;
		}
	>;
	canImport: boolean;
	reason?: string;
}

export interface PostTypeAnalysis {
	name: string;
	count: number;
	suggestedCollection: string;
	requiredFields: ImportFieldDef[];
	schemaStatus: CollectionSchemaStatus;
}

export interface AttachmentInfo {
	id?: number;
	title?: string;
	url?: string;
	filename?: string;
	mimeType?: string;
}

export interface NavMenu {
	name: string;
	slug: string;
	count: number;
}

export interface CustomTaxonomy {
	name: string;
	slug: string;
	count: number;
	hierarchical: boolean;
}

export interface WpAuthorInfo {
	id?: number;
	login?: string;
	email?: string;
	displayName?: string;
	postCount: number;
}

export interface WxrAnalysis {
	site: {
		title: string;
		url: string;
	};
	postTypes: PostTypeAnalysis[];
	attachments: {
		count: number;
		items: AttachmentInfo[];
	};
	categories: number;
	tags: number;
	authors: WpAuthorInfo[];
	customFields: Array<{
		key: string;
		count: number;
		samples: string[];
		suggestedField: string;
		suggestedType: string;
		isInternal: boolean;
	}>;
	navMenus?: NavMenu[];
	customTaxonomies?: CustomTaxonomy[];
}

export interface PrepareRequest {
	postTypes: Array<{
		name: string;
		collection: string;
		fields: ImportFieldDef[];
	}>;
}

export interface PrepareResult {
	success: boolean;
	collectionsCreated: string[];
	fieldsCreated: Array<{ collection: string; field: string }>;
	errors: Array<{ collection: string; error: string }>;
}

export interface AuthorMapping {
	wpLogin: string;
	wpDisplayName: string;
	wpEmail?: string;
	emdashUserId: string | null;
	postCount: number;
}

export interface ImportConfig {
	postTypeMappings: Record<
		string,
		{
			collection: string;
			enabled: boolean;
		}
	>;
	skipExisting: boolean;
	authorMappings?: Record<string, string | null>;
	importMenus?: boolean;
	importSiteTitle?: boolean;
	importLogo?: boolean;
	importSeo?: boolean;
}

export interface ImportResult {
	success: boolean;
	imported: number;
	skipped: number;
	errors: Array<{ title: string; error: string }>;
	byCollection: Record<string, number>;
	taxonomyAssignments?: number;
	missingTaxonomies?: string[];
	taxonomiesCreated?: string[];
	menus?: { created: number; items: number };
	comments?: { imported: number; skipped: number };
	siteSettings?: string[];
}

interface WpImportCursor {
	postTypeIndex: number;
	page: number;
}

interface WpImportChunkState {
	idMap: Record<string, { id: string; collection: string }>;
	translationGroups: Record<string, string>;
	commentRoots: Record<string, string>;
}

interface WpImportChunkResponse {
	success: boolean;
	result: ImportResult;
	done: boolean;
	cursor?: WpImportCursor;
	chunk?: Partial<WpImportChunkState>;
}

export interface WpImportProgress {
	phase: "content" | "comments" | "finalize";
	processed: number;
	comments: number;
}

async function executeWpPluginImportChunk(
	url: string,
	token: string,
	config: ImportConfig,
	phase: WpImportProgress["phase"],
	cursor: WpImportCursor | undefined,
	state: WpImportChunkState,
): Promise<WpImportChunkResponse> {
	const response = await apiFetch(`${API_BASE}/import/wordpress-plugin/execute`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			url,
			token,
			config,
			phase,
			cursor,
			idMap: state.idMap,
			translationGroups: state.translationGroups,
			commentRoots: state.commentRoots,
		}),
	});
	return parseApiResponse<WpImportChunkResponse>(response, "Failed to import from WordPress");
}

function mergeImportResults(into: ImportResult, chunk: ImportResult): void {
	into.imported += chunk.imported;
	into.skipped += chunk.skipped;
	into.errors.push(...chunk.errors);
	for (const [collection, count] of Object.entries(chunk.byCollection)) {
		into.byCollection[collection] = (into.byCollection[collection] || 0) + count;
	}
	if (chunk.taxonomyAssignments) {
		into.taxonomyAssignments = (into.taxonomyAssignments ?? 0) + chunk.taxonomyAssignments;
	}
	if (chunk.missingTaxonomies?.length) {
		into.missingTaxonomies = [
			...new Set([...(into.missingTaxonomies ?? []), ...chunk.missingTaxonomies]),
		];
	}
	if (chunk.taxonomiesCreated?.length) {
		into.taxonomiesCreated = [...(into.taxonomiesCreated ?? []), ...chunk.taxonomiesCreated];
	}
	if (chunk.menus) into.menus = chunk.menus;
	if (chunk.comments) {
		into.comments = {
			imported: (into.comments?.imported ?? 0) + chunk.comments.imported,
			skipped: (into.comments?.skipped ?? 0) + chunk.comments.skipped,
		};
	}
	if (chunk.siteSettings) into.siteSettings = chunk.siteSettings;
	into.success = into.errors.length === 0;
}

export async function executeWpPluginImport(
	url: string,
	token: string,
	config: ImportConfig,
	onProgress?: (progress: WpImportProgress) => void,
): Promise<ImportResult> {
	const aggregate: ImportResult = {
		success: true,
		imported: 0,
		skipped: 0,
		errors: [],
		byCollection: {},
	};
	const state: WpImportChunkState = { idMap: {}, translationGroups: {}, commentRoots: {} };
	let comments = 0;

	const runPhase = async (phase: WpImportProgress["phase"]) => {
		let cursor: WpImportCursor | undefined;
		let done = false;
		while (!done) {
			const chunk = await executeWpPluginImportChunk(url, token, config, phase, cursor, state);
			mergeImportResults(aggregate, chunk.result);
			Object.assign(state.idMap, chunk.chunk?.idMap);
			Object.assign(state.translationGroups, chunk.chunk?.translationGroups);
			Object.assign(state.commentRoots, chunk.chunk?.commentRoots);
			comments += (chunk.result.comments?.imported ?? 0) + (chunk.result.comments?.skipped ?? 0);
			onProgress?.({
				phase,
				processed: aggregate.imported + aggregate.skipped,
				comments,
			});
			done = chunk.done;
			cursor = chunk.cursor;
		}
	};

	await runPhase("content");
	await runPhase("comments");
	await runPhase("finalize");

	return aggregate;
}

export async function analyzeWxr(file: File): Promise<WxrAnalysis> {
	const formData = new FormData();
	formData.append("file", file);

	const response = await apiFetch(`${API_BASE}/import/wordpress/analyze`, {
		method: "POST",
		body: formData,
	});
	return parseApiResponse<WxrAnalysis>(response, "Failed to analyze file");
}

export async function prepareWxrImport(request: PrepareRequest): Promise<PrepareResult> {
	const response = await apiFetch(`${API_BASE}/import/wordpress/prepare`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(request),
	});
	return parseApiResponse<PrepareResult>(response, "Failed to prepare import");
}

export async function executeWxrImport(file: File, config: ImportConfig): Promise<ImportResult> {
	const formData = new FormData();
	formData.append("file", file);
	formData.append("config", JSON.stringify(config));

	const response = await apiFetch(`${API_BASE}/import/wordpress/execute`, {
		method: "POST",
		body: formData,
	});
	return parseApiResponse<ImportResult>(response, "Failed to import");
}

export interface MediaImportResult {
	imported: Array<{
		wpId?: number;
		originalUrl: string;
		newUrl: string;
		mediaId: string;
	}>;
	failed: Array<{
		wpId?: number;
		originalUrl: string;
		error: string;
	}>;
	urlMap: Record<string, string>;
}

export interface MediaImportProgress {
	type: "progress";
	current: number;
	total: number;
	filename?: string;
	status: "downloading" | "uploading" | "done" | "skipped" | "failed";
	error?: string;
}

export interface RewriteUrlsResult {
	updated: number;
	byCollection: Record<string, number>;
	urlsRewritten: number;
	errors: Array<{ collection: string; id: string; error: string }>;
}

export async function importWxrMedia(
	attachments: AttachmentInfo[],
	onProgress?: (progress: MediaImportProgress) => void,
): Promise<MediaImportResult> {
	const response = await apiFetch(`${API_BASE}/import/wordpress/media`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ attachments, stream: !!onProgress }),
	});

	if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to import media`));

	if (!onProgress) {
		return parseApiResponse<MediaImportResult>(response, "Failed to import media");
	}

	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error("Response body is not readable");
	}

	const decoder = new TextDecoder();
	let buffer = "";
	let result: MediaImportResult | null = null;

	while (true) {
		const { done, value } = await reader.read();

		if (done) break;

		buffer += decoder.decode(value, { stream: true });

		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		for (const line of lines) {
			if (!line.trim()) continue;

			try {
				const parsed: { type?: string; imported?: unknown } = JSON.parse(line);
				if (parsed.type === "progress") {
					// eslint-disable-next-line typescript/no-unsafe-type-assertion -- SSE event data is parsed JSON; discriminated by type === "progress"
					onProgress(parsed as MediaImportProgress);
				} else if (parsed.type === "result" || parsed.imported) {
					// eslint-disable-next-line typescript/no-unsafe-type-assertion -- SSE event data is parsed JSON; discriminated by type === "result"
					result = parsed as MediaImportResult;
				}
			} catch {
				console.warn("Failed to parse NDJSON line:", line);
			}
		}
	}

	if (buffer.trim()) {
		try {
			const parsed: { type?: string; imported?: unknown } = JSON.parse(buffer);
			if (parsed.type === "result" || parsed.imported) {
				// eslint-disable-next-line typescript/no-unsafe-type-assertion -- SSE event data is parsed JSON; discriminated by type === "result"
				result = parsed as MediaImportResult;
			}
		} catch {
			console.warn("Failed to parse final NDJSON:", buffer);
		}
	}

	if (!result) {
		throw new Error("No result received from media import");
	}

	return result;
}

const MEDIA_BATCH_SIZE = 25;

export async function importWxrMediaBatched(
	attachments: AttachmentInfo[],
	onProgress?: (progress: MediaImportProgress) => void,
): Promise<MediaImportResult> {
	const merged: MediaImportResult = { imported: [], failed: [], urlMap: {} };

	for (let offset = 0; offset < attachments.length; offset += MEDIA_BATCH_SIZE) {
		const batch = attachments.slice(offset, offset + MEDIA_BATCH_SIZE);
		const result = await importWxrMedia(
			batch,
			onProgress &&
				((progress) =>
					onProgress({
						...progress,
						current: offset + progress.current,
						total: attachments.length,
					})),
		);
		merged.imported.push(...result.imported);
		merged.failed.push(...result.failed);
		Object.assign(merged.urlMap, result.urlMap);
	}

	return merged;
}

export interface SourceCapabilities {
	publicContent: boolean;
	privateContent: boolean;
	customPostTypes: boolean;
	allMeta: boolean;
	mediaStream: boolean;
}

export interface SourceAuth {
	type: "oauth" | "token" | "password" | "none";
	provider?: string;
	oauthUrl?: string;
	instructions?: string;
}

export type SuggestedAction =
	| { type: "proceed" }
	| { type: "oauth"; url: string; provider: string }
	| { type: "upload"; instructions: string }
	| { type: "install-plugin"; instructions: string };

export interface SourceProbeResult {
	sourceId: string;
	confidence: "definite" | "likely" | "possible";
	detected: {
		platform: string;
		version?: string;
		siteTitle?: string;
		siteUrl?: string;
	};
	capabilities: SourceCapabilities;
	auth?: SourceAuth;
	suggestedAction: SuggestedAction;
	preview?: {
		posts?: number;
		pages?: number;
		media?: number;
	};
}

export interface ProbeResult {
	url: string;
	isWordPress: boolean;
	bestMatch: SourceProbeResult | null;
	allMatches: SourceProbeResult[];
}

export async function probeImportUrl(url: string): Promise<ProbeResult> {
	const response = await apiFetch(`${API_BASE}/import/probe`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ url }),
	});
	const data = await parseApiResponse<{ result: ProbeResult }>(response, "Failed to probe URL");
	return data.result;
}

export async function rewriteContentUrls(
	urlMap: Record<string, string>,
	collections?: string[],
): Promise<RewriteUrlsResult> {
	const response = await apiFetch(`${API_BASE}/import/wordpress/rewrite-urls`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ urlMap, collections }),
	});
	return parseApiResponse<RewriteUrlsResult>(response, "Failed to rewrite URLs");
}

export interface WpPluginAnalysis {
	sourceId: string;
	site: {
		title: string;
		url: string;
	};
	postTypes: PostTypeAnalysis[];
	attachments: {
		count: number;
		items: AttachmentInfo[];
	};
	categories: number;
	tags: number;
	authors: WpAuthorInfo[];
	navMenus?: NavMenu[];
	customTaxonomies?: CustomTaxonomy[];
}

export async function analyzeWpPluginSite(url: string, token: string): Promise<WpPluginAnalysis> {
	const response = await apiFetch(`${API_BASE}/import/wordpress-plugin/analyze`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ url, token }),
	});
	const data = await parseApiResponse<{ analysis: WpPluginAnalysis }>(
		response,
		"Failed to analyze WordPress site",
	);
	return data.analysis;
}
