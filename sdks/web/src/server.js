// Server-only helpers for the SuperBoard transactional email API.
//
// They require a secret server API key (sb_email_…) created in
// Communication › Settings › Senders & domains. Never ship that key to a
// browser, a mobile application or any other client you do not control.

const KEY_FORMAT = /^sb_email_[a-f0-9]{64}$/;
const DEFAULT_TIMEOUT_MS = 30_000;

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

	/** Sends (or schedules) a transactional email. Returns `{ id, status, scheduled_at }`. */
	sendEmail(input, options = {}) {
		const body = emailRequestBody(input);
		return this.#request("POST", "/v1/email/send", {
			body,
			idempotencyKey: options.idempotencyKey ?? input?.idempotencyKey,
			signal: options.signal,
		});
	}

	/** Returns the status, recipients and timeline of a message sent with this project's keys. */
	getEmail(id, options = {}) {
		return this.#request(
			"GET",
			`/v1/email/messages/${encodeURIComponent(requiredId(id))}`,
			options,
		);
	}

	/** Cancels a scheduled message that has not been released yet. */
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

/** One-shot helper: `sendEmail({ apiUrl, secretKey }, message)`. */
export function sendEmail(options, input, requestOptions) {
	return new SuperBoardServer(options).sendEmail(input, requestOptions);
}

/**
 * Verifies an outbound event webhook. `signature` is the X-SuperBoard-Signature
 * header (`v1=<hex>`), `timestamp` the X-SuperBoard-Timestamp header and
 * `payload` the raw request body, before any JSON parsing.
 */
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
