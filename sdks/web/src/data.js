import { SuperBoardError } from "./errors.js";

const MEBIBYTE = 1024 * 1024;
export const MINIMUM_PART_SIZE = 5 * MEBIBYTE;
const DEFAULT_PART_SIZE = 8 * MEBIBYTE;
const DEFAULT_SIGNED_URL_SECONDS = 3600;
const TRANSFORM_KEYS = ["width", "height", "fit", "format", "quality"];
const OPERATORS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is"]);
const RESERVED_PARAMETERS = new Set([
	"select",
	"order",
	"limit",
	"cursor",
	"count",
	"upsert",
	"confirm",
]);
const COLUMN_PATTERN = /^[a-z][a-z0-9_]{0,47}$/u;

export function parseOrigin(apiUrl) {
	const url = new URL(apiUrl);
	const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (
		(url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
		url.username ||
		url.password
	)
		throw new TypeError(
			"Use an HTTPS SuperBoard origin, or HTTP on loopback for local development.",
		);
	return url.origin;
}

export async function responseError(response) {
	let payload = null;
	try {
		payload = await response.json();
	} catch {
		payload = null;
	}
	const error = payload && typeof payload.error === "object" && payload.error ? payload.error : {};
	return new SuperBoardError(
		typeof error.code === "string" ? error.code : `http_${response.status}`,
		typeof error.message === "string"
			? error.message
			: `SuperBoard request failed with HTTP ${response.status}.`,
		response.status,
		error.details,
		error.retryable === true || response.status === 429 || response.status >= 500,
	);
}

export function createDataTransport(options) {
	const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
	const signalFor = (signal) => {
		if (!options.timeoutMs) return signal;
		const timeout = AbortSignal.timeout(options.timeoutMs);
		return signal ? AbortSignal.any([signal, timeout]) : timeout;
	};
	return {
		origin: options.origin,
		projectId: options.projectId ?? null,
		async request(method, path, request = {}) {
			const url = new URL(`${options.origin}/v1/data${path}`);
			for (const [name, value] of request.query ?? []) url.searchParams.append(name, value);
			const send = async () => {
				const headers = new Headers(await options.headers());
				headers.set("Accept", request.as === "json" || !request.as ? "application/json" : "*/*");
				for (const [name, value] of Object.entries(request.headers ?? {}))
					if (value !== undefined) headers.set(name, value);
				let body = request.body;
				if (request.json !== undefined) {
					headers.set("Content-Type", "application/json");
					body = JSON.stringify(request.json);
				}
				return fetchImpl(url.href, {
					method,
					headers,
					...(body === undefined ? {} : { body }),
					credentials: "omit",
					redirect: "error",
					signal: signalFor(request.signal),
				});
			};
			let response = await send();
			if (
				response.status === 401 &&
				options.retryUnauthorized &&
				!request.signal?.aborted &&
				(await options.retryUnauthorized())
			)
				response = await send();
			if (request.as === "response") return response;
			if (!response.ok) throw await responseError(response);
			if (request.as === "text") return response.text();
			if (request.as === "blob") return response.blob();
			if (response.status === 204) return null;
			try {
				return await response.json();
			} catch {
				throw new SuperBoardError(
					"invalid_response",
					"SuperBoard returned an invalid JSON response.",
					response.status,
				);
			}
		},
	};
}

function segment(value, label) {
	if (typeof value !== "string" || !value) throw new TypeError(`${label} is required.`);
	return encodeURIComponent(value);
}

function objectPath(path) {
	if (typeof path !== "string" || !path || path.startsWith("/"))
		throw new TypeError("Object paths are relative and non-empty, such as avatars/user.png.");
	return path.split("/").map(encodeURIComponent).join("/");
}

function transformQuery(transform) {
	const query = [];
	for (const key of TRANSFORM_KEYS) {
		const value = transform?.[key];
		if (value !== undefined && value !== null) query.push([key, String(value)]);
	}
	return query;
}

function column(name) {
	if (typeof name !== "string" || !COLUMN_PATTERN.test(name) || RESERVED_PARAMETERS.has(name))
		throw new TypeError(`${String(name)} is not a column that can be filtered.`);
	return name;
}

function scalar(value) {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "string") return value;
	if (typeof value === "boolean" || typeof value === "bigint") return String(value);
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	throw new TypeError("Filter values are strings, finite numbers, booleans or dates.");
}

function listItem(value) {
	const text = scalar(value);
	return /[",]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function operand(operator, value) {
	if (operator === "in") {
		if (!Array.isArray(value) || value.length === 0)
			throw new TypeError("in() needs a non-empty array of values.");
		return `(${value.map(listItem).join(",")})`;
	}
	if (operator === "is") {
		if (value !== null && value !== true && value !== false)
			throw new TypeError("is() accepts null, true or false.");
		return String(value);
	}
	return scalar(value);
}

export class QueryBuilder {
	#transport;
	#table;
	#state;

	constructor(transport, table, state = {}) {
		if (typeof table !== "string" || !table) throw new TypeError("A table name is required.");
		this.#transport = transport;
		this.#table = table;
		this.#state = { filters: [], ...state };
	}

	#with(changes) {
		return new QueryBuilder(this.#transport, this.#table, { ...this.#state, ...changes });
	}

	#filter(name, expression) {
		return this.#with({ filters: [...this.#state.filters, [column(name), expression]] });
	}

	#path(id) {
		const table = segment(this.#table, "A table name");
		return id === undefined ? `/db/${table}` : `/db/${table}/${segment(id, "A row id")}`;
	}

	#query({ filters = true, listing = true } = {}) {
		const query = [];
		if (this.#state.select) query.push(["select", this.#state.select]);
		if (filters) query.push(...this.#state.filters);
		if (listing) {
			if (this.#state.order) query.push(["order", this.#state.order]);
			if (this.#state.limit !== undefined) query.push(["limit", String(this.#state.limit)]);
			if (this.#state.cursor) query.push(["cursor", this.#state.cursor]);
			if (this.#state.count) query.push(["count", "exact"]);
		}
		return query;
	}

	#requireFilters(action) {
		if (this.#state.filters.length === 0)
			throw new TypeError(
				`${action}() needs at least one filter; use ${action}ById() for one row.`,
			);
	}

	select(columns = "*") {
		const value = Array.isArray(columns) ? columns.join(",") : String(columns);
		return this.#with({ select: value === "*" ? undefined : value });
	}
	filter(name, operator, value) {
		if (!OPERATORS.has(operator)) throw new TypeError(`Unknown filter operator ${operator}.`);
		return this.#filter(name, `${operator}.${operand(operator, value)}`);
	}
	eq(name, value) {
		return value === null ? this.is(name, null) : this.filter(name, "eq", value);
	}
	neq(name, value) {
		return value === null ? this.not(name, "is", null) : this.filter(name, "neq", value);
	}
	gt(name, value) {
		return this.filter(name, "gt", value);
	}
	gte(name, value) {
		return this.filter(name, "gte", value);
	}
	lt(name, value) {
		return this.filter(name, "lt", value);
	}
	lte(name, value) {
		return this.filter(name, "lte", value);
	}
	like(name, pattern) {
		return this.filter(name, "like", pattern);
	}
	ilike(name, pattern) {
		return this.filter(name, "ilike", pattern);
	}
	in(name, values) {
		return this.filter(name, "in", values);
	}
	is(name, value) {
		return this.filter(name, "is", value);
	}
	not(name, operator, value) {
		if (!OPERATORS.has(operator)) throw new TypeError(`Unknown filter operator ${operator}.`);
		return this.#filter(name, `not.${operator}.${operand(operator, value)}`);
	}
	order(name, { ascending = true } = {}) {
		if (typeof name !== "string" || !COLUMN_PATTERN.test(name))
			throw new TypeError(`${String(name)} is not a column that can be ordered.`);
		return this.#with({ order: `${name}.${ascending ? "asc" : "desc"}` });
	}
	limit(count) {
		if (!Number.isSafeInteger(count) || count < 1)
			throw new TypeError("limit() needs a positive integer.");
		return this.#with({ limit: count });
	}
	cursor(value) {
		if (value !== null && value !== undefined && typeof value !== "string")
			throw new TypeError("cursor() needs the nextCursor string of a previous page.");
		return this.#with({ cursor: value ?? undefined });
	}
	count() {
		return this.#with({ count: true });
	}

	get({ signal } = {}) {
		return this.#transport.request("GET", this.#path(), { query: this.#query(), signal });
	}
	// oxlint-disable-next-line unicorn/no-thenable -- awaiting a query runs it, like a PostgREST client
	then(onFulfilled, onRejected) {
		return this.get().then(onFulfilled, onRejected);
	}
	async *pages({ signal } = {}) {
		let builder = this;
		for (;;) {
			const page = await builder.get({ signal });
			yield page;
			if (!page?.nextCursor) return;
			builder = builder.cursor(page.nextCursor);
		}
	}
	single(id, { signal } = {}) {
		return this.#transport.request("GET", this.#path(id), {
			query: this.#query({ filters: false, listing: false }),
			signal,
		});
	}
	insert(values, { upsert = false, signal } = {}) {
		if (!values || typeof values !== "object")
			throw new TypeError("insert() needs an object or an array of objects.");
		return this.#transport.request("POST", this.#path(), {
			query: upsert ? [["upsert", "true"]] : [],
			json: values,
			signal,
		});
	}
	update(values, { signal } = {}) {
		this.#requireFilters("update");
		return this.#transport.request("PATCH", this.#path(), {
			query: this.#query({ listing: false }),
			json: values,
			signal,
		});
	}
	updateById(id, values, { signal } = {}) {
		return this.#transport.request("PATCH", this.#path(id), { json: values, signal });
	}
	delete({ signal } = {}) {
		this.#requireFilters("delete");
		return this.#transport.request("DELETE", this.#path(), {
			query: this.#query({ listing: false }),
			signal,
		});
	}
	deleteById(id, { signal } = {}) {
		return this.#transport.request("DELETE", this.#path(id), { signal });
	}
}

function blobOf(body, contentType) {
	const type = contentType ?? "";
	if (typeof Blob !== "undefined" && body instanceof Blob)
		return contentType && body.type !== contentType ? body.slice(0, body.size, type) : body;
	if (typeof body === "string" || body instanceof ArrayBuffer || ArrayBuffer.isView(body))
		return new Blob([body], { type: type || (typeof body === "string" ? "text/plain" : "") });
	throw new TypeError("Upload a Blob, File, ArrayBuffer, typed array or string.");
}

export class BucketClient {
	#transport;
	#bucket;

	constructor(transport, bucket) {
		this.#transport = transport;
		this.#bucket = segment(bucket, "A bucket name");
	}

	upload(path, body, { contentType, upsert = false, signal } = {}) {
		const blob = blobOf(body, contentType);
		return this.#transport.request("PUT", `/storage/object/${this.#bucket}/${objectPath(path)}`, {
			body: blob,
			headers: {
				"Content-Type": blob.type || "application/octet-stream",
				...(upsert ? { "x-upsert": "true" } : {}),
			},
			signal,
		});
	}
	download(path, { transform, signal } = {}) {
		return this.#transport.request("GET", `/storage/object/${this.#bucket}/${objectPath(path)}`, {
			query: transformQuery(transform),
			as: "blob",
			signal,
		});
	}
	list({ prefix, limit, cursor, signal } = {}) {
		const query = [];
		if (prefix) query.push(["prefix", prefix]);
		if (limit !== undefined) query.push(["limit", String(limit)]);
		if (cursor) query.push(["cursor", cursor]);
		return this.#transport.request("GET", `/storage/list/${this.#bucket}`, { query, signal });
	}
	remove(path, { signal } = {}) {
		return this.#transport.request(
			"DELETE",
			`/storage/object/${this.#bucket}/${objectPath(path)}`,
			{ signal },
		);
	}
	createSignedUrl(path, expiresIn = DEFAULT_SIGNED_URL_SECONDS, { transform, signal } = {}) {
		const transformation = Object.fromEntries(transformQuery(transform));
		return this.#transport.request("POST", `/storage/sign/${this.#bucket}/${objectPath(path)}`, {
			json: {
				expires_in: expiresIn,
				...(Object.keys(transformation).length ? { transform: transformation } : {}),
			},
			signal,
		});
	}
	getPublicUrl(path, { transform } = {}) {
		const projectId = this.#transport.projectId;
		if (projectId === null || projectId === undefined || projectId === "")
			throw new TypeError("Pass projectId to the client to build public object URLs.");
		const url = new URL(
			`${this.#transport.origin}/v1/data/storage/public/${encodeURIComponent(String(projectId))}/${this.#bucket}/${objectPath(path)}`,
		);
		for (const [name, value] of transformQuery(transform)) url.searchParams.set(name, value);
		return url.href;
	}

	async uploadLarge(path, body, options = {}) {
		const blob = blobOf(body, options.contentType);
		const partSize = options.partSize ?? DEFAULT_PART_SIZE;
		if (!Number.isSafeInteger(partSize) || partSize < MINIMUM_PART_SIZE)
			throw new TypeError(`partSize is an integer of at least ${MINIMUM_PART_SIZE} bytes.`);
		if (blob.size === 0) return this.upload(path, blob, options);
		const base = `/storage/uploads/${this.#bucket}`;
		const { signal } = options;
		const total = blob.size;
		const count = Math.ceil(total / partSize);
		const sizeOf = (part) => Math.min(partSize, total - (part - 1) * partSize);
		const received = new Map();
		let uploadId = options.resumeUploadId;
		if (uploadId) {
			const status = await this.#transport.request(
				"GET",
				`${base}/${segment(uploadId, "An upload id")}`,
				{ signal },
			);
			if (status.path !== path)
				throw new SuperBoardError(
					"upload_resume_mismatch",
					"This upload belongs to another object path.",
				);
			for (const part of status.parts ?? []) {
				if (part.part_number > count)
					throw new SuperBoardError(
						"upload_resume_mismatch",
						"Resume the upload with the same file and part size.",
					);
				received.set(part.part_number, part.size);
			}
		} else {
			const started = await this.#transport.request("POST", base, {
				json: {
					path,
					content_type: blob.type || "application/octet-stream",
					upsert: options.upsert === true,
				},
				signal,
			});
			uploadId = started.upload_id;
		}
		const parts = Array.from({ length: count }, (_, index) => index + 1);
		let uploadedBytes = parts
			.filter((part) => received.get(part) === sizeOf(part))
			.reduce((sum, part) => sum + sizeOf(part), 0);
		options.onProgress?.({ uploadId, uploadedBytes, totalBytes: total });
		const target = `${base}/${segment(uploadId, "An upload id")}`;
		try {
			for (const part of parts) {
				if (received.get(part) === sizeOf(part)) continue;
				const start = (part - 1) * partSize;
				// oxlint-disable-next-line no-await-in-loop -- parts are sent in order so a failure can resume
				await this.#transport.request("PUT", `${target}/${part}`, {
					body: blob.slice(start, start + sizeOf(part)),
					headers: { "Content-Type": "application/octet-stream" },
					signal,
				});
				uploadedBytes += sizeOf(part);
				options.onProgress?.({ uploadId, uploadedBytes, totalBytes: total, partNumber: part });
			}
			return await this.#transport.request("POST", `${target}/complete`, { signal });
		} catch (error) {
			if (error && typeof error === "object") error.uploadId = uploadId;
			throw error;
		}
	}
	abortUpload(uploadId, { signal } = {}) {
		return this.#transport.request(
			"DELETE",
			`/storage/uploads/${this.#bucket}/${segment(uploadId, "An upload id")}`,
			{ signal },
		);
	}
}

export class StorageClient {
	#transport;

	constructor(transport) {
		this.#transport = transport;
	}

	from(bucket) {
		return new BucketClient(this.#transport, bucket);
	}
	listBuckets({ signal } = {}) {
		return this.#transport.request("GET", "/storage/buckets", { signal });
	}
}

function functionBody(body) {
	if (body === undefined || body === null) return {};
	if (
		typeof body === "string" ||
		body instanceof ArrayBuffer ||
		ArrayBuffer.isView(body) ||
		(typeof Blob !== "undefined" && body instanceof Blob) ||
		(typeof FormData !== "undefined" && body instanceof FormData) ||
		(typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams)
	)
		return { body };
	return { json: body };
}

async function parsedBody(response) {
	if (response.status === 204) return null;
	const type = response.headers.get("content-type") ?? "";
	if (/\bjson\b/iu.test(type)) {
		const text = await response.text();
		return text ? JSON.parse(text) : null;
	}
	if (type.startsWith("text/")) return response.text();
	return response.blob();
}

export class FunctionsClient {
	#transport;

	constructor(transport) {
		this.#transport = transport;
	}

	async invoke(name, options = {}) {
		const method = (options.method ?? "POST").toUpperCase();
		const path = options.path ?? "/";
		if (typeof path !== "string" || !path.startsWith("/"))
			throw new TypeError("A function path starts with /.");
		const suffix = path === "/" ? "" : path.split("/").map(encodeURIComponent).join("/");
		const response = await this.#transport.request(
			method,
			`/functions/${segment(name, "A function name")}${suffix}`,
			{
				...(method === "GET" || method === "HEAD" ? {} : functionBody(options.body)),
				query: Object.entries(options.query ?? {}).map(([key, value]) => [key, String(value)]),
				headers: options.headers,
				as: "response",
				signal: options.signal,
			},
		);
		if (options.raw) return response;
		if (!response.ok) {
			const failure = await responseError(response.clone());
			let body = null;
			try {
				body = await parsedBody(response);
			} catch {
				body = null;
			}
			if (!failure.details && failure.code === `http_${response.status}`)
				failure.details = { body };
			throw failure;
		}
		return parsedBody(response);
	}
}

export class VectorCollectionClient {
	#transport;
	#collection;

	constructor(transport, collection) {
		this.#transport = transport;
		this.#collection = segment(collection, "A collection name");
	}

	upsert(items, { signal } = {}) {
		return this.#transport.request("POST", `/vectors/${this.#collection}/upsert`, {
			json: { items: Array.isArray(items) ? items : [items] },
			signal,
		});
	}
	query({ text, values, topK, filter, signal } = {}) {
		return this.#transport.request("POST", `/vectors/${this.#collection}/query`, {
			json: {
				...(text === undefined ? {} : { text }),
				...(values === undefined ? {} : { values }),
				...(topK === undefined ? {} : { top_k: topK }),
				...(filter === undefined ? {} : { filter }),
			},
			signal,
		});
	}
	remove(id, { signal } = {}) {
		return this.#transport.request(
			"DELETE",
			`/vectors/${this.#collection}/${segment(id, "An item id")}`,
			{ signal },
		);
	}
}

export class VectorsClient {
	#transport;

	constructor(transport) {
		this.#transport = transport;
	}

	from(collection) {
		return new VectorCollectionClient(this.#transport, collection);
	}
}

export class AiClient {
	#transport;

	constructor(transport) {
		this.#transport = transport;
	}

	embeddings(input, { signal } = {}) {
		return this.#transport.request("POST", "/ai/embeddings", { json: { input }, signal });
	}
}
