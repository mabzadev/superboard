import {
	AiClient,
	FunctionsClient,
	QueryBuilder,
	StorageClient,
	VectorsClient,
	createDataTransport,
	parseOrigin,
} from "./data.js";
import { SuperBoardError } from "./errors.js";

export { SuperBoardError };

const KEY_FORMAT = /^sb_email_[a-f0-9]{64}$/;
const SECRET_KEY_FORMAT = /^sb_secret_[A-Za-z0-9_-]{43}$/;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ADMIN_TIMEOUT_MS = 60_000;

export class SuperBoardEmailError extends Error {
	constructor(code, message, status = 0, details = undefined, retryable = false) {
		super(message);
		this.name = "SuperBoardEmailError";
		this.code = code;
		this.status = status;
		this.details = details;
		this.retryable = retryable;
	}
}

export class SuperBoardServer {
	#origin;
	#secretKey;
	#fetch;
	#timeoutMs;

	constructor(options) {
		if (!options || typeof options !== "object") throw new TypeError("options are required.");
		if (isBrowser() && options.dangerouslyAllowBrowser !== true)
			throw new TypeError(
				"@superboard/web/server is server-only: a secret API key must never be exposed in a browser.",
			);
		const url = new URL(options.apiUrl);
		const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		if (
			(url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
			url.username ||
			url.password
		)
			throw new TypeError(
				"Use an HTTPS SuperBoard origin, or HTTP on loopback for local development.",
			);
		if (!KEY_FORMAT.test(String(options.secretKey ?? "")))
			throw new TypeError("secretKey must be a SuperBoard server API key (sb_email_…).");
		this.#origin = url.origin;
		this.#secretKey = options.secretKey;
		this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
		this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	}

	sendEmail(input, options = {}) {
		const body = emailRequestBody(input);
		return this.#request("POST", "/v1/email/send", {
			body,
			idempotencyKey: options.idempotencyKey ?? input?.idempotencyKey,
			signal: options.signal,
		});
	}

	getEmail(id, options = {}) {
		return this.#request(
			"GET",
			`/v1/email/messages/${encodeURIComponent(requiredId(id))}`,
			options,
		);
	}

	cancelEmail(id, options = {}) {
		return this.#request(
			"POST",
			`/v1/email/messages/${encodeURIComponent(requiredId(id))}/cancel`,
			{ ...options, body: {} },
		);
	}

	async #request(method, path, { body, idempotencyKey, signal } = {}) {
		const headers = {
			Authorization: `Bearer ${this.#secretKey}`,
			Accept: "application/json",
			"X-SuperBoard-SDK-Version": "0.1.0",
		};
		if (body !== undefined) headers["Content-Type"] = "application/json";
		if (idempotencyKey) headers["Idempotency-Key"] = String(idempotencyKey);
		const timeout = AbortSignal.timeout(this.#timeoutMs);
		const response = await this.#fetch(`${this.#origin}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			redirect: "error",
			credentials: "omit",
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		});
		let payload = null;
		try {
			payload = await response.json();
		} catch {
			payload = null;
		}
		if (!response.ok) {
			const error = payload?.error ?? {};
			throw new SuperBoardEmailError(
				typeof error.code === "string" ? error.code : `http_${response.status}`,
				typeof error.message === "string"
					? error.message
					: `Request failed with HTTP ${response.status}`,
				response.status,
				error.details,
				error.retryable === true || response.status === 429 || response.status >= 500,
			);
		}
		return payload;
	}
}

function name(value, label) {
	if (typeof value !== "string" || !value) throw new TypeError(`${label} is required.`);
	return encodeURIComponent(value);
}

function confirmed(value) {
	return [["confirm", value]];
}

export function schemaFromTables(tables) {
	return {
		tables: tables.map((table) => ({
			name: table.name,
			...(table.label ? { label: table.label } : {}),
			rules: table.rules,
			realtime: table.realtime === true,
			columns: [...(table.columns ?? [])]
				.sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
				.map((column) => ({
					name: column.name,
					type: column.type,
					nullable: column.nullable,
					...(column.default === null || column.default === undefined
						? {}
						: { default: column.default }),
					unique: column.unique === true,
					indexed: column.indexed === true,
				})),
		})),
	};
}

class ManagementClient {
	#transport;

	constructor(transport) {
		this.#transport = transport;
		const request = (method, path, options) => transport.request(method, `/manage${path}`, options);
		this.tables = {
			list: (options = {}) => request("GET", "/tables", options),
			get: (table, options = {}) => request("GET", `/tables/${name(table, "A table")}`, options),
			create: (definition, options = {}) =>
				request("POST", "/tables", { ...options, json: definition }),
			update: (table, changes, options = {}) =>
				request("PATCH", `/tables/${name(table, "A table")}`, { ...options, json: changes }),
			delete: (table, options = {}) =>
				request("DELETE", `/tables/${name(table, "A table")}`, {
					...options,
					query: confirmed(table),
				}),
			addColumn: (table, column, options = {}) =>
				request("POST", `/tables/${name(table, "A table")}/columns`, { ...options, json: column }),
			updateColumn: (table, column, changes, options = {}) =>
				request("PATCH", `/tables/${name(table, "A table")}/columns/${name(column, "A column")}`, {
					...options,
					json: changes,
				}),
			dropColumn: (table, column, options = {}) =>
				request("DELETE", `/tables/${name(table, "A table")}/columns/${name(column, "A column")}`, {
					...options,
					query: confirmed(column),
				}),
		};
		this.schema = {
			pull: async (options = {}) => schemaFromTables((await this.tables.list(options)).items),
			push: (schema, { dryRun = false, allowDestructive = false, prune, signal } = {}) =>
				request("POST", "/schema", {
					query: [
						...(dryRun ? [["dry_run", "true"]] : []),
						...(allowDestructive ? [["allow_destructive", "true"]] : []),
					],
					json: prune === undefined ? schema : { ...schema, prune },
					signal,
				}),
		};
		this.buckets = {
			list: (options = {}) => request("GET", "/buckets", options),
			create: (bucket, options = {}) => request("POST", "/buckets", { ...options, json: bucket }),
			update: (bucket, changes, options = {}) =>
				request("PATCH", `/buckets/${name(bucket, "A bucket")}`, { ...options, json: changes }),
			delete: (bucket, options = {}) =>
				request("DELETE", `/buckets/${name(bucket, "A bucket")}`, {
					...options,
					query: confirmed(bucket),
				}),
		};
		this.functions = {
			list: (options = {}) => request("GET", "/functions", options),
			get: (fn, options = {}) => request("GET", `/functions/${name(fn, "A function")}`, options),
			deploy: (fn, { source, access, timeoutMs, vars, secrets, signal } = {}) =>
				request("PUT", `/functions/${name(fn, "A function")}`, {
					json: Object.fromEntries(
						Object.entries({ source, access, timeout_ms: timeoutMs, vars, secrets }).filter(
							([, value]) => value !== undefined,
						),
					),
					signal,
				}),
			delete: (fn, options = {}) =>
				request("DELETE", `/functions/${name(fn, "A function")}`, {
					...options,
					query: confirmed(fn),
				}),
			rollback: (fn, version, options = {}) =>
				request("POST", `/functions/${name(fn, "A function")}/rollback`, {
					...options,
					json: { version },
				}),
			runs: (fn, { limit, signal } = {}) =>
				request("GET", `/functions/${name(fn, "A function")}/runs`, {
					query: limit === undefined ? [] : [["limit", String(limit)]],
					signal,
				}),
			schedule: (fn, cron, { enabled, signal } = {}) =>
				request("PUT", `/functions/${name(fn, "A function")}/schedule`, {
					json: { cron, ...(enabled === undefined ? {} : { enabled }) },
					signal,
				}),
			unschedule: (fn, options = {}) =>
				request("DELETE", `/functions/${name(fn, "A function")}/schedule`, options),
			test: (fn, { method, path, body, headers, signal } = {}) =>
				request("POST", `/functions/${name(fn, "A function")}/invoke`, {
					json: Object.fromEntries(
						Object.entries({ method, path, body, headers }).filter(
							([, value]) => value !== undefined,
						),
					),
					signal,
				}),
		};
		this.vectorCollections = {
			list: (options = {}) => request("GET", "/vector-collections", options),
			create: (collection, options = {}) =>
				request("POST", "/vector-collections", { ...options, json: collection }),
			update: (collection, changes, options = {}) =>
				request("PATCH", `/vector-collections/${name(collection, "A collection")}`, {
					...options,
					json: changes,
				}),
			delete: (collection, options = {}) =>
				request("DELETE", `/vector-collections/${name(collection, "A collection")}`, {
					...options,
					query: confirmed(collection),
				}),
		};
		this.settings = {
			get: (options = {}) => request("GET", "/settings", options),
			update: (changes, options = {}) =>
				request("PATCH", "/settings", { ...options, json: changes }),
		};
	}

	status(options = {}) {
		return this.#transport.request("GET", "/manage/status", options);
	}
	types(options = {}) {
		return this.#transport.request("GET", "/manage/types", { ...options, as: "text" });
	}
	openapi(options = {}) {
		return this.#transport.request("GET", "/openapi.json", options);
	}
}

export class SuperBoardAdmin {
	#transport;
	#storage = null;
	#functions = null;
	#vectors = null;
	#ai = null;
	#manage = null;

	constructor(options) {
		if (!options || typeof options !== "object") throw new TypeError("options are required.");
		if (isBrowser() && options.dangerouslyAllowBrowser !== true)
			throw new TypeError(
				"SuperBoardAdmin is server-only: a secret server key must never be exposed in a browser.",
			);
		const origin = parseOrigin(options.apiUrl);
		const secretKey = String(options.secretKey ?? "");
		if (!SECRET_KEY_FORMAT.test(secretKey))
			throw new TypeError("secretKey must be a SuperBoard server key (sb_secret_…).");
		this.#transport = createDataTransport({
			origin,
			fetch: options.fetch,
			projectId: options.projectId,
			timeoutMs: options.timeoutMs ?? DEFAULT_ADMIN_TIMEOUT_MS,
			headers: () => ({
				Authorization: `Bearer ${secretKey}`,
				"X-SuperBoard-SDK-Version": "0.1.0",
			}),
		});
		const transport = this.#transport;
		this.realtime = {
			broadcast: (channel, event, payload, { signal } = {}) =>
				transport.request("POST", "/realtime/broadcast", {
					json: { channel, event, payload: payload ?? null },
					signal,
				}),
		};
	}

	from(table) {
		return new QueryBuilder(this.#transport, table);
	}
	get storage() {
		this.#storage ??= new StorageClient(this.#transport);
		return this.#storage;
	}
	get functions() {
		this.#functions ??= new FunctionsClient(this.#transport);
		return this.#functions;
	}
	get vectors() {
		this.#vectors ??= new VectorsClient(this.#transport);
		return this.#vectors;
	}
	get ai() {
		this.#ai ??= new AiClient(this.#transport);
		return this.#ai;
	}
	get manage() {
		this.#manage ??= new ManagementClient(this.#transport);
		return this.#manage;
	}
}

export function sendEmail(options, input, requestOptions) {
	return new SuperBoardServer(options).sendEmail(input, requestOptions);
}

export async function verifyWebhookSignature({
	payload,
	signature,
	timestamp,
	secret,
	toleranceSeconds = 300,
	now = Date.now(),
}) {
	if (!secret || !signature || !timestamp || typeof payload !== "string") return false;
	const seconds = Number(timestamp);
	if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > toleranceSeconds) return false;
	const key = await globalThis.crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const expected = new Uint8Array(
		await globalThis.crypto.subtle.sign(
			"HMAC",
			key,
			new TextEncoder().encode(`${timestamp}.${payload}`),
		),
	);
	const candidates = String(signature)
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.startsWith("v1="))
		.map((part) => part.slice(3));
	return candidates.some((candidate) => constantTimeEqualHex(candidate, expected));
}

function emailRequestBody(input) {
	if (!input || typeof input !== "object") throw new TypeError("The email message is required.");
	const body = {
		to: input.to,
		from: input.from,
		subject: input.subject,
		html: input.html,
		text: input.text,
		template_id: input.templateId ?? input.template_id,
		variables: input.variables,
		locale: input.locale,
		reply_to: input.replyTo ?? input.reply_to,
		headers: input.headers,
		tags: input.tags,
		metadata: input.metadata,
		attachments: input.attachments?.map((attachment) => ({
			filename: attachment.filename,
			content: base64Content(attachment.content),
			content_type: attachment.contentType ?? attachment.content_type,
			content_id: attachment.contentId ?? attachment.content_id,
			disposition: attachment.disposition,
		})),
		scheduled_at:
			(input.scheduledAt ?? input.scheduled_at) instanceof Date
				? (input.scheduledAt ?? input.scheduled_at).toISOString()
				: (input.scheduledAt ?? input.scheduled_at),
	};
	return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

function base64Content(content) {
	if (typeof content === "string") return content;
	const bytes =
		content instanceof Uint8Array
			? content
			: content instanceof ArrayBuffer
				? new Uint8Array(content)
				: null;
	if (!bytes)
		throw new TypeError("Attachment content must be a base64 string, Uint8Array or ArrayBuffer.");
	if (typeof globalThis.Buffer?.from === "function")
		return globalThis.Buffer.from(bytes).toString("base64");
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	return btoa(binary);
}

function requiredId(id) {
	if (typeof id !== "string" || !id) throw new TypeError("A message id is required.");
	return id;
}

function constantTimeEqualHex(candidate, expected) {
	if (!/^[a-f0-9]+$/i.test(candidate) || candidate.length !== expected.length * 2) return false;
	let difference = 0;
	for (let index = 0; index < expected.length; index += 1)
		difference |= Number.parseInt(candidate.slice(index * 2, index * 2 + 2), 16) ^ expected[index];
	return difference === 0;
}

function isBrowser() {
	return typeof globalThis.window !== "undefined" && typeof globalThis.document !== "undefined";
}
