export interface S3StorageConfig {
	endpoint: string;
	bucket: string;
	accessKeyId?: string;
	secretAccessKey?: string;
	region?: string;
	publicUrl?: string;
}

export interface LocalStorageConfig {
	directory: string;
	baseUrl: string;
}

export interface StorageDescriptor {
	entrypoint: string;
	config: Record<string, unknown>;
}

export type CreateStorageFn = (config: Record<string, unknown>) => Storage;

export interface UploadResult {
	key: string;
	url: string;
	size: number;
}

export interface DownloadResult {
	body: ReadableStream<Uint8Array>;
	contentType: string;
	size: number;
}

export interface SignedUploadUrl {
	url: string;
	method: "PUT";
	headers: Record<string, string>;
	expiresAt: string;
}

export interface SignedUploadOptions {
	key: string;
	contentType: string;
	size?: number;
	expiresIn?: number;
}

export interface ListResult {
	files: FileInfo[];
	nextCursor?: string;
}

export interface FileInfo {
	key: string;
	size: number;
	lastModified: Date;
	etag?: string;
}

export interface ListOptions {
	prefix?: string;
	limit?: number;
	cursor?: string;
}

export interface Storage {
	upload(options: {
		key: string;
		body: Buffer | Uint8Array | ReadableStream<Uint8Array>;
		contentType: string;
	}): Promise<UploadResult>;

	download(key: string): Promise<DownloadResult>;

	delete(key: string): Promise<void>;

	exists(key: string): Promise<boolean>;

	list(options?: ListOptions): Promise<ListResult>;

	getSignedUploadUrl(options: SignedUploadOptions): Promise<SignedUploadUrl>;

	getPublicUrl(key: string): string;

	getClientUploadOrigin?(): string;
}

export class EmDashStorageError extends Error {
	constructor(
		message: string,
		public code: string,
		public override cause?: unknown,
	) {
		super(message);
		this.name = "EmDashStorageError";
	}
}
