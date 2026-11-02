import { env } from "cloudflare:workers";
import type {
	Storage,
	UploadResult,
	DownloadResult,
	ListResult,
	ListOptions,
	SignedUploadUrl,
	SignedUploadOptions,
} from "emdash";
import { EmDashStorageError } from "emdash";

const TRAILING_SLASH_REGEX = /\/$/;

export class R2Storage implements Storage {
	private bucket: R2Bucket;
	private publicUrl?: string;

	constructor(bucket: R2Bucket, publicUrl?: string) {
		this.bucket = bucket;
		this.publicUrl = publicUrl;
	}

	async upload(options: {
		key: string;
		body: Buffer | Uint8Array | ReadableStream<Uint8Array>;
		contentType: string;
	}): Promise<UploadResult> {
		try {
			const result = await this.bucket.put(options.key, options.body, {
				httpMetadata: {
					contentType: options.contentType,
				},
			});

			if (!result) {
				throw new EmDashStorageError(`Failed to upload file: ${options.key}`, "UPLOAD_FAILED");
			}

			return {
				key: options.key,
				url: this.getPublicUrl(options.key),
				size: result.size,
			};
		} catch (error) {
			if (error instanceof EmDashStorageError) throw error;
			throw new EmDashStorageError(`Failed to upload file: ${options.key}`, "UPLOAD_FAILED", error);
		}
	}

	async download(key: string): Promise<DownloadResult> {
		try {
			const object = await this.bucket.get(key);

			if (!object) {
				throw new EmDashStorageError(`File not found: ${key}`, "NOT_FOUND");
			}

			if (!("body" in object) || !object.body) {
				throw new EmDashStorageError(`File not found: ${key}`, "NOT_FOUND");
			}

			return {
				body: object.body,
				contentType: object.httpMetadata?.contentType || "application/octet-stream",
				size: object.size,
			};
		} catch (error) {
			if (error instanceof EmDashStorageError) throw error;
			throw new EmDashStorageError(`Failed to download file: ${key}`, "DOWNLOAD_FAILED", error);
		}
	}

	async delete(key: string): Promise<void> {
		try {
			await this.bucket.delete(key);
		} catch (error) {
			throw new EmDashStorageError(`Failed to delete file: ${key}`, "DELETE_FAILED", error);
		}
	}

	async exists(key: string): Promise<boolean> {
		try {
			const object = await this.bucket.head(key);
			return object !== null;
		} catch (error) {
			throw new EmDashStorageError(`Failed to check file existence: ${key}`, "HEAD_FAILED", error);
		}
	}

	async list(options: ListOptions = {}): Promise<ListResult> {
		try {
			const response = await this.bucket.list({
				prefix: options.prefix,
				limit: options.limit,
				cursor: options.cursor,
			});

			return {
				files: response.objects.map((item) => ({
					key: item.key,
					size: item.size,
					lastModified: item.uploaded,
					etag: item.etag,
				})),
				nextCursor: response.truncated ? response.cursor : undefined,
			};
		} catch (error) {
			throw new EmDashStorageError("Failed to list files", "LIST_FAILED", error);
		}
	}

	async getSignedUploadUrl(_options: SignedUploadOptions): Promise<SignedUploadUrl> {
		throw new EmDashStorageError(
			"R2 bindings do not support pre-signed upload URLs. " +
				"Use the S3 API with R2 credentials for signed URL support, " +
				"or upload through the Worker.",
			"NOT_SUPPORTED",
		);
	}

	getPublicUrl(key: string): string {
		if (this.publicUrl) {
			return `${this.publicUrl.replace(TRAILING_SLASH_REGEX, "")}/${key}`;
		}
		return `/_emdash/api/media/file/${key}`;
	}
}

export function createStorage(config: Record<string, unknown>): Storage {
	const binding = typeof config.binding === "string" ? config.binding : "";
	const publicUrl = typeof config.publicUrl === "string" ? config.publicUrl : undefined;

	if (!binding) {
		throw new EmDashStorageError(
			`R2 binding name is required in storage config.`,
			"BINDING_NOT_FOUND",
		);
	}

	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- R2Bucket binding accessed from untyped env object
	const bucket = (env as Record<string, unknown>)[binding] as R2Bucket | undefined;

	if (!bucket) {
		throw new EmDashStorageError(
			`R2 binding "${binding}" not found. ` +
				`Make sure the binding is defined in wrangler.jsonc and ` +
				`you're running on Cloudflare Workers.\n\n` +
				`Example wrangler.jsonc:\n` +
				`{\n` +
				`  "r2_buckets": [{\n` +
				`    "binding": "${binding}",\n` +
				`    "bucket_name": "my-bucket"\n` +
				`  }]\n` +
				`}`,
			"BINDING_NOT_FOUND",
		);
	}

	return new R2Storage(bucket, publicUrl);
}
