export type Row = Record<string, unknown> & { id: string; owner_id: string | null };
export type FilterValue = string | number | boolean | bigint | Date;
export type FilterOperator =
	| "eq"
	| "neq"
	| "gt"
	| "gte"
	| "lt"
	| "lte"
	| "like"
	| "ilike"
	| "in"
	| "is";

export interface Page<T> {
	items: T[];
	nextCursor?: string;
	count?: number;
}
export interface RequestSignal {
	signal?: AbortSignal;
}

export class QueryBuilder<T extends Record<string, unknown> = Row> implements PromiseLike<Page<T>> {
	private constructor();
	select(columns?: string | string[]): QueryBuilder<T>;
	filter(column: string, operator: FilterOperator, value: unknown): QueryBuilder<T>;
	eq(column: string, value: FilterValue | null): QueryBuilder<T>;
	neq(column: string, value: FilterValue | null): QueryBuilder<T>;
	gt(column: string, value: FilterValue): QueryBuilder<T>;
	gte(column: string, value: FilterValue): QueryBuilder<T>;
	lt(column: string, value: FilterValue): QueryBuilder<T>;
	lte(column: string, value: FilterValue): QueryBuilder<T>;
	/** `*` matches any characters (case-sensitive). */
	like(column: string, pattern: string): QueryBuilder<T>;
	/** `*` matches any characters (case-insensitive). */
	ilike(column: string, pattern: string): QueryBuilder<T>;
	in(column: string, values: FilterValue[]): QueryBuilder<T>;
	is(column: string, value: null | boolean): QueryBuilder<T>;
	not(column: string, operator: FilterOperator, value: unknown): QueryBuilder<T>;
	order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>;
	limit(count: number): QueryBuilder<T>;
	cursor(cursor: string | null | undefined): QueryBuilder<T>;
	count(): QueryBuilder<T>;
	get(options?: RequestSignal): Promise<Page<T>>;
	then<TResult1 = Page<T>, TResult2 = never>(
		onfulfilled?: ((value: Page<T>) => TResult1 | PromiseLike<TResult1>) | null,
		onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
	): Promise<TResult1 | TResult2>;
	pages(options?: RequestSignal): AsyncGenerator<Page<T>, void, unknown>;
	single(id: string, options?: RequestSignal): Promise<T>;
	insert(values: Partial<T>, options?: { upsert?: boolean } & RequestSignal): Promise<T>;
	insert(
		values: Partial<T>[],
		options?: { upsert?: boolean } & RequestSignal,
	): Promise<{ items: T[] }>;
	update(values: Partial<T>, options?: RequestSignal): Promise<{ items: T[] }>;
	updateById(id: string, values: Partial<T>, options?: RequestSignal): Promise<T>;
	delete(options?: RequestSignal): Promise<{ items: T[] }>;
	deleteById(id: string, options?: RequestSignal): Promise<{ deleted: true; item: T }>;
}

export interface ImageTransform {
	width?: number;
	height?: number;
	fit?: "scale-down" | "contain" | "cover" | "crop" | "pad";
	format?: "webp" | "avif" | "jpeg" | "png";
	quality?: number;
}
export interface StoredObject {
	bucket: string;
	path: string;
	owner_id: string | null;
	content_type: string;
	size: number;
	etag: string;
	created_at: string;
	updated_at: string;
}
export interface Bucket {
	name: string;
	public: boolean;
	max_bytes: number;
	allowed_types: string[] | null;
	[key: string]: unknown;
}
export type UploadBody = Blob | ArrayBuffer | ArrayBufferView | string;
export interface UploadProgress {
	uploadId: string;
	uploadedBytes: number;
	totalBytes: number;
	partNumber?: number;
}
export interface LargeUploadOptions extends RequestSignal {
	/** At least 5 MiB; 8 MiB by default. Resume with the same value. */
	partSize?: number;
	contentType?: string;
	upsert?: boolean;
	resumeUploadId?: string;
	onProgress?: (progress: UploadProgress) => void;
}

export class BucketClient {
	private constructor();
	upload(
		path: string,
		body: UploadBody,
		options?: { contentType?: string; upsert?: boolean } & RequestSignal,
	): Promise<StoredObject>;
	/** Errors carry the `uploadId` to pass back as `resumeUploadId`. */
	uploadLarge(path: string, body: UploadBody, options?: LargeUploadOptions): Promise<StoredObject>;
	abortUpload(uploadId: string, options?: RequestSignal): Promise<{ aborted: true }>;
	download(path: string, options?: { transform?: ImageTransform } & RequestSignal): Promise<Blob>;
	list(
		options?: { prefix?: string; limit?: number; cursor?: string } & RequestSignal,
	): Promise<Page<StoredObject>>;
	remove(path: string, options?: RequestSignal): Promise<{ deleted: true; item: StoredObject }>;
	createSignedUrl(
		path: string,
		expiresIn?: number,
		options?: { transform?: ImageTransform } & RequestSignal,
	): Promise<{ url: string; expires_at: string }>;
	/** Needs the `projectId` client option. */
	getPublicUrl(path: string, options?: { transform?: ImageTransform }): string;
}
export class StorageClient {
	private constructor();
	from(bucket: string): BucketClient;
	listBuckets(options?: RequestSignal): Promise<{ items: Bucket[] }>;
}

export interface InvokeOptions extends RequestSignal {
	method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
	body?: unknown;
	headers?: Record<string, string>;
	/** Path inside the function, starting with `/`. */
	path?: string;
	query?: Record<string, string | number | boolean>;
	/** Return the Response as received, without throwing on an error status. */
	raw?: boolean;
}
export class FunctionsClient {
	private constructor();
	invoke(name: string, options: InvokeOptions & { raw: true }): Promise<Response>;
	invoke<T = unknown>(name: string, options?: InvokeOptions): Promise<T>;
}

export interface VectorItem {
	id: string;
	text?: string;
	values?: number[];
	metadata?: Record<string, string | number | boolean>;
}
export interface VectorMatch {
	id: string;
	score: number;
	content: string | null;
	metadata: Record<string, unknown>;
	owner_id: string | null;
}
export class VectorCollectionClient {
	private constructor();
	upsert(
		items: VectorItem | VectorItem[],
		options?: RequestSignal,
	): Promise<{ items: { id: string }[] }>;
	query(
		query: {
			text?: string;
			values?: number[];
			topK?: number;
			filter?: Record<string, string | number | boolean>;
		} & RequestSignal,
	): Promise<{ items: VectorMatch[] }>;
	remove(id: string, options?: RequestSignal): Promise<{ deleted: true }>;
}
export class VectorsClient {
	private constructor();
	from(collection: string): VectorCollectionClient;
}
export class AiClient {
	private constructor();
	embeddings(
		input: string | string[],
		options?: RequestSignal,
	): Promise<{ model: string; dimensions: number; data: { index: number; embedding: number[] }[] }>;
}
