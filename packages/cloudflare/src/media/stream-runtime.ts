import { env } from "cloudflare:workers";
import type {
	MediaProvider,
	MediaListOptions,
	MediaValue,
	EmbedOptions,
	EmbedResult,
	CreateMediaProviderFn,
} from "emdash/media";

import type { CloudflareStreamConfig } from "./stream.js";

function toString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function resolveEnvValue(
	directValue: string | undefined,
	envVarName: string | undefined,
	defaultEnvVar: string,
	serviceName: string,
): string {
	if (directValue) return directValue;
	const envVar = envVarName || defaultEnvVar;
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Worker binding accessed from untyped env object
	const value = (env as Record<string, string | undefined>)[envVar];
	if (!value) {
		throw new Error(
			`${serviceName}: Missing ${envVar}. Set it as an environment variable or provide it directly in config.`,
		);
	}
	return value;
}

export const createMediaProvider: CreateMediaProviderFn<CloudflareStreamConfig> = (config) => {
	const { customerSubdomain, controls = true, autoplay = false, loop = false, muted } = config;

	const accountId = resolveEnvValue(
		config.accountId,
		config.accountIdEnvVar,
		"CF_ACCOUNT_ID",
		"Cloudflare Stream",
	);
	const apiToken = resolveEnvValue(
		config.apiToken,
		config.apiTokenEnvVar,
		"CF_STREAM_TOKEN",
		"Cloudflare Stream",
	);

	const apiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`;
	const headers = { Authorization: `Bearer ${apiToken}` };

	const isMuted = muted ?? autoplay;

	const provider: MediaProvider = {
		async list(options: MediaListOptions) {
			const params = new URLSearchParams();

			if (options.cursor) {
				params.set("after", options.cursor);
			}

			params.set("asc", "false");

			if (options.query) {
				params.set("search", options.query);
			}

			const url = `${apiBase}?${params}`;
			const response = await fetch(url, { headers });

			if (!response.ok) {
				throw new Error(`Cloudflare Stream API error: ${response.status}`);
			}

			const data: CloudflareStreamListResponse = await response.json();

			if (!data.success) {
				throw new Error(
					`Cloudflare Stream API error: ${data.errors?.[0]?.message || "Unknown error"}`,
				);
			}

			const lastVideo = data.result.at(-1);
			const nextCursor = lastVideo?.uid;

			return {
				items: data.result.map((video) => ({
					id: video.uid,
					filename: toString(video.meta?.name) || video.uid,
					mimeType: "video/mp4",
					width: video.input?.width,
					height: video.input?.height,
					previewUrl: video.thumbnail,
					meta: {
						duration: video.duration,
						playback: video.playback,
						status: video.status,
						created: video.created,
						modified: video.modified,
						size: video.size,
					},
				})),
				nextCursor: data.result.length > 0 ? nextCursor : undefined,
			};
		},

		async get(id: string) {
			const url = `${apiBase}/${id}`;
			const response = await fetch(url, { headers });

			if (!response.ok) {
				if (response.status === 404) return null;
				throw new Error(`Cloudflare Stream API error: ${response.status}`);
			}

			const data: CloudflareStreamResponse = await response.json();

			if (!data.success) {
				return null;
			}

			const video = data.result;
			return {
				id: video.uid,
				filename: toString(video.meta?.name) || video.uid,
				mimeType: "video/mp4",
				width: video.input?.width,
				height: video.input?.height,
				previewUrl: video.thumbnail,
				meta: {
					duration: video.duration,
					playback: video.playback,
					status: video.status,
					created: video.created,
					modified: video.modified,
					size: video.size,
				},
			};
		},

		async upload(input) {
			const createResponse = await fetch(`${apiBase}/direct_upload`, {
				method: "POST",
				headers: {
					...headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					maxDurationSeconds: 3600,
					meta: {
						name: input.filename,
					},
				}),
			});

			if (!createResponse.ok) {
				const error = await createResponse.text();
				throw new Error(`Failed to create upload URL: ${error}`);
			}

			const createData: CloudflareStreamDirectUploadResponse = await createResponse.json();

			if (!createData.success) {
				throw new Error(
					`Failed to create upload URL: ${createData.errors?.[0]?.message || "Unknown error"}`,
				);
			}

			const uploadUrl = createData.result.uploadURL;
			const formData = new FormData();
			formData.append("file", input.file, input.filename);

			const uploadResponse = await fetch(uploadUrl, {
				method: "POST",
				body: formData,
			});

			if (!uploadResponse.ok) {
				const error = await uploadResponse.text();
				throw new Error(`Upload failed: ${error}`);
			}

			const videoId = createData.result.uid;

			let video: CloudflareStreamVideo | null = null;
			for (let i = 0; i < 10; i++) {
				await new Promise((resolve) => setTimeout(resolve, 1000));

				const checkResponse = await fetch(`${apiBase}/${videoId}`, { headers });
				if (checkResponse.ok) {
					const checkData: CloudflareStreamResponse = await checkResponse.json();
					if (checkData.success && checkData.result.status?.state !== "queued") {
						video = checkData.result;
						break;
					}
				}
			}

			if (!video) {
				return {
					id: videoId,
					filename: input.filename,
					mimeType: "video/mp4",
					previewUrl: undefined,
					meta: {
						status: { state: "processing" },
					},
				};
			}

			return {
				id: video.uid,
				filename: toString(video.meta?.name) || input.filename,
				mimeType: "video/mp4",
				width: video.input?.width,
				height: video.input?.height,
				previewUrl: video.thumbnail,
				meta: {
					duration: video.duration,
					playback: video.playback,
					status: video.status,
				},
			};
		},

		async delete(id: string) {
			const response = await fetch(`${apiBase}/${id}`, {
				method: "DELETE",
				headers,
			});

			if (!response.ok && response.status !== 404) {
				throw new Error(`Cloudflare Stream delete failed: ${response.status}`);
			}
		},

		getEmbed(value: MediaValue, options?: EmbedOptions): EmbedResult {
			const rawPlayback = value.meta?.playback;
			const playback = isRecord(rawPlayback) ? rawPlayback : undefined;

			const hlsSrc = toString(playback?.hls);
			const dashSrc = toString(playback?.dash);

			if (hlsSrc) {
				return {
					type: "video",
					sources: [
						{ src: hlsSrc, type: "application/x-mpegURL" },
						...(dashSrc ? [{ src: dashSrc, type: "application/dash+xml" }] : []),
					],
					poster: value.previewUrl ?? toString(value.meta?.thumbnail),
					width: options?.width ?? value.width,
					height: options?.height ?? value.height,
					controls,
					autoplay,
					loop,
					muted: isMuted,
					playsinline: true,
					preload: "metadata",
				};
			}

			const baseUrl = customerSubdomain
				? `https://${customerSubdomain}`
				: `https://customer-${accountId.slice(0, 8)}.cloudflarestream.com`;

			return {
				type: "video",
				src: `${baseUrl}/${value.id}/manifest/video.m3u8`,
				poster: `${baseUrl}/${value.id}/thumbnails/thumbnail.jpg`,
				width: options?.width ?? value.width,
				height: options?.height ?? value.height,
				controls,
				autoplay,
				loop,
				muted: isMuted,
				playsinline: true,
				preload: "metadata",
			};
		},

		getThumbnailUrl(id: string, _mimeType?: string, options?: { width?: number; height?: number }) {
			const baseUrl = customerSubdomain
				? `https://${customerSubdomain}`
				: `https://customer-${accountId.slice(0, 8)}.cloudflarestream.com`;

			const width = options?.width || 400;
			const height = options?.height;
			let url = `${baseUrl}/${id}/thumbnails/thumbnail.jpg?width=${width}`;
			if (height) url += `&height=${height}`;
			return url;
		},
	};

	return provider;
};

interface CloudflareStreamListResponse {
	success: boolean;
	errors?: Array<{ message: string }>;
	result: CloudflareStreamVideo[];
}

interface CloudflareStreamResponse {
	success: boolean;
	errors?: Array<{ message: string }>;
	result: CloudflareStreamVideo;
}

interface CloudflareStreamDirectUploadResponse {
	success: boolean;
	errors?: Array<{ message: string }>;
	result: {
		uploadURL: string;
		uid: string;
	};
}

interface CloudflareStreamVideo {
	uid: string;
	thumbnail: string;
	thumbnailTimestampPct?: number;
	readyToStream: boolean;
	status: {
		state: string;
		pctComplete?: string;
		errorReasonCode?: string;
		errorReasonText?: string;
	};
	meta?: Record<string, unknown>;
	created: string;
	modified: string;
	size: number;
	preview?: string;
	allowedOrigins?: string[];
	requireSignedURLs: boolean;
	uploaded?: string;
	scheduledDeletion?: string;
	input?: {
		width: number;
		height: number;
	};
	playback?: {
		hls: string;
		dash: string;
	};
	watermark?: unknown;
	duration: number;
}
