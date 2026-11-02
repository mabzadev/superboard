export interface ContentfulIncludes {
	entries: Map<string, ContentfulEntry>;
	assets: Map<string, ContentfulAsset>;
}

export interface ContentfulEntry {
	id: string;
	contentType: string;
	fields: Record<string, unknown>;
}

export interface ContentfulAsset {
	id: string;
	title?: string;
	description?: string;
	url: string;
	width?: number;
	height?: number;
	contentType?: string;
}

export interface ConvertOptions {
	blogHostname?: string;
	entryHrefResolver?: (entry: ContentfulEntry) => string;
}

export interface ContentfulLinkPayload {
	sys: { id: string };
}

export interface ContentfulSysEnvelope {
	sys: { id: string; contentType?: { sys: { id: string } } };
	fields?: Record<string, unknown>;
}

export interface ContentfulAssetFile {
	url?: string;
	contentType?: string;
	details?: {
		image?: {
			width?: number;
			height?: number;
		};
	};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isContentfulLinkPayload(value: unknown): value is ContentfulLinkPayload {
	if (!isObject(value)) return false;
	const sys = value.sys;
	if (!isObject(sys)) return false;
	return typeof sys.id === "string";
}

export function isContentfulSysEnvelope(value: unknown): value is ContentfulSysEnvelope {
	if (!isObject(value)) return false;
	const sys = value.sys;
	if (!isObject(sys)) return false;
	if (typeof sys.id !== "string") return false;
	if (sys.contentType !== undefined) {
		if (!isObject(sys.contentType)) return false;
		const ctSys = sys.contentType.sys;
		if (!isObject(ctSys) || typeof ctSys.id !== "string") return false;
	}
	if (value.fields !== undefined && !isObject(value.fields)) return false;
	return true;
}

export function getStringField(
	fields: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = fields?.[key];
	return typeof value === "string" ? value : undefined;
}

export function getRecordField(
	fields: Record<string, unknown> | undefined,
	key: string,
): Record<string, unknown> | undefined {
	const value = fields?.[key];
	return isObject(value) ? value : undefined;
}

export function parseAssetFile(value: unknown): ContentfulAssetFile | undefined {
	if (!isObject(value)) return undefined;
	const file: ContentfulAssetFile = {};
	if (typeof value.url === "string") file.url = value.url;
	if (typeof value.contentType === "string") file.contentType = value.contentType;
	if (isObject(value.details)) {
		const image = isObject(value.details.image) ? value.details.image : undefined;
		if (image) {
			file.details = {
				image: {
					width: typeof image.width === "number" ? image.width : undefined,
					height: typeof image.height === "number" ? image.height : undefined,
				},
			};
		}
	}
	return file;
}
