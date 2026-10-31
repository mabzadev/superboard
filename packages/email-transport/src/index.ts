export type SmtpPublicConfig = {
	host: string;
	port: number;
	security: "tls" | "starttls" | "plain";
	username: string | null;
	from_email: string;
	from_name: string | null;
	reply_to: string | null;
};

export type SmtpSecretConfig = { password: string | null };

export type SmtpAttachment = {
	/** Display filename. It is sanitized and RFC 2231 encoded by the transport. */
	filename: string;
	/** MIME type such as application/pdf. Invalid values fall back to application/octet-stream. */
	contentType?: string | null;
	/** Standard base64 content (whitespace is ignored). */
	content: string;
	/** Optional Content-ID for inline images referenced as cid:<contentId> in HTML. */
	contentId?: string | null;
	disposition?: "attachment" | "inline";
};

export type SmtpMessage = {
	to: string;
	subject: string;
	html: string | null;
	text: string | null;
	headers?: Record<string, string>;
	messageId?: string;
	attachments?: SmtpAttachment[];
};

/** Maximum decoded size of all attachments of one message. */
export const EMAIL_ATTACHMENTS_MAX_BYTES = 10 * 1024 * 1024;
/** Maximum number of attachments of one message. */
export const EMAIL_ATTACHMENTS_MAX_COUNT = 20;

export class EmailTransportError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status = 503,
		readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "EmailTransportError";
	}
}

export async function sendSmtpMessage(
	config: SmtpPublicConfig,
	secret: SmtpSecretConfig,
	message: SmtpMessage,
): Promise<{ messageId: string; response: string }> {
	// Build (and validate attachments) before opening a socket so invalid input
	// never reaches the provider and never becomes an ambiguous SMTP outcome.
	const built = buildMessage(config, message);
	const { connect } = await import("cloudflare:sockets");
	let socket = connect(
		{ hostname: config.host, port: config.port },
		{
			secureTransport:
				config.security === "tls" ? "on" : config.security === "starttls" ? "starttls" : "off",
			allowHalfOpen: false,
		},
	);
	await socket.opened;
	let session = new SmtpSession(socket);
	try {
		await session.expect([220]);
		await session.command(
			`EHLO ${sanitizeDomain(config.from_email.split("@")[1] || "superboard.local")}`,
			[250],
		);
		if (config.security === "starttls") {
			await session.command("STARTTLS", [220]);
			session.release();
			socket = socket.startTls({ expectedServerHostname: config.host });
			await socket.opened;
			session = new SmtpSession(socket);
			await session.command(
				`EHLO ${sanitizeDomain(config.from_email.split("@")[1] || "superboard.local")}`,
				[250],
			);
		}
		if (config.username) {
			if (!secret.password) throw error("smtp_password_missing", "SMTP password is missing");
			await session.command(
				`AUTH PLAIN ${toBase64(`\0${config.username}\0${secret.password}`)}`,
				[235],
			);
		}
		await session.command(`MAIL FROM:<${sanitizeMailbox(config.from_email)}>`, [250]);
		await session.command(`RCPT TO:<${sanitizeMailbox(message.to)}>`, [250, 251]);
		await session.command("DATA", [354]);
		let accepted: { code: number; text: string };
		try {
			await session.write(`${dotStuff(built)}\r\n.\r\n`);
			accepted = await session.expect([250]);
		} catch (cause) {
			if (cause instanceof EmailTransportError && cause.code === "smtp_rejected") {
				throw cause;
			}
			throw error(
				"smtp_outcome_unknown",
				"SMTP acceptance could not be confirmed after transmitting the message",
				503,
				{ phase: "provider_acceptance" },
			);
		}
		// A 250 response is the provider acceptance boundary. QUIT only closes the
		// SMTP session; losing its response must never turn an accepted message
		// into a retryable delivery.
		await session.command("QUIT", [221]).catch(() => undefined);
		return {
			messageId: extractMessageId(accepted.text) || built.messageId,
			response: accepted.text,
		};
	} finally {
		session.release();
		await socket.close().catch(() => undefined);
	}
}

class SmtpSession {
	private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
	private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
	private buffer = "";

	constructor(private readonly socket: Socket) {
		this.reader = socket.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
		this.writer = socket.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
	}

	async command(value: string, expected: number[]) {
		await this.write(`${value}\r\n`);
		return this.expect(expected);
	}

	async write(value: string) {
		await this.writer.write(new TextEncoder().encode(value));
	}

	async expect(expected: number[]): Promise<{ code: number; text: string }> {
		const lines: string[] = [];
		let code = 0;
		while (true) {
			const line = await this.readLine();
			if (!/^\d{3}[ -]/.test(line))
				throw error("smtp_protocol_error", "SMTP server returned an invalid response", 502);
			code = Number(line.slice(0, 3));
			lines.push(line.slice(4));
			if (line[3] === " ") break;
			if (lines.length > 100)
				throw error("smtp_protocol_error", "SMTP response exceeded the allowed size", 502);
		}
		if (!expected.includes(code)) {
			throw error(
				"smtp_rejected",
				`SMTP server rejected the command (${code})`,
				code >= 500 ? 422 : 503,
				{ smtp_code: code },
			);
		}
		return { code, text: lines.join("\n").slice(0, 4_000) };
	}

	release() {
		this.reader.releaseLock();
		this.writer.releaseLock();
	}

	private async readLine(): Promise<string> {
		while (!this.buffer.includes("\n")) {
			const { done, value } = await this.reader.read();
			if (done) throw error("smtp_connection_closed", "SMTP connection closed unexpectedly");
			this.buffer += new TextDecoder().decode(value, { stream: true });
			if (this.buffer.length > 64_000)
				throw error("smtp_protocol_error", "SMTP response exceeded the allowed size", 502);
		}
		const index = this.buffer.indexOf("\n");
		const line = this.buffer.slice(0, index).replace(/\r$/, "");
		this.buffer = this.buffer.slice(index + 1);
		return line;
	}
}

export function buildMessage(config: SmtpPublicConfig, message: SmtpMessage) {
	const messageId = message.messageId
		? sanitizeMessageId(message.messageId)
		: `<${crypto.randomUUID()}@${sanitizeDomain(config.from_email.split("@")[1] || "superboard.local")}>`;
	const boundary = `superboard-${crypto.randomUUID()}`;
	const customHeaders = Object.entries(message.headers || {}).map(([name, value]) => {
		const normalizedName = sanitizeHeaderName(name);
		if (RESERVED_MESSAGE_HEADERS.has(normalizedName.toLowerCase())) {
			throw error(
				"email_header_reserved",
				`Email header ${normalizedName} is managed by the transport`,
				422,
			);
		}
		return `${normalizedName}: ${sanitizeHeaderValue(value)}`;
	});
	const headers = [
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: ${messageId}`,
		`From: ${config.from_name ? `${encodeHeader(config.from_name)} <${sanitizeMailbox(config.from_email)}>` : sanitizeMailbox(config.from_email)}`,
		`To: ${sanitizeMailbox(message.to)}`,
		`Subject: ${encodeHeader(message.subject)}`,
		...(config.reply_to ? [`Reply-To: ${sanitizeMailbox(config.reply_to)}`] : []),
		...customHeaders,
		"MIME-Version: 1.0",
	];
	const content = contentPart(message, boundary);
	const attachments = normalizeAttachments(message.attachments);
	const inline = attachments.filter((attachment) => attachment.disposition === "inline");
	const regular = attachments.filter((attachment) => attachment.disposition === "attachment");
	let root = content;
	if (inline.length) {
		root = multipart("related", `${boundary}-related`, [content, ...inline.map(attachmentPart)]);
	}
	if (regular.length) {
		root = multipart("mixed", `${boundary}-mixed`, [root, ...regular.map(attachmentPart)]);
	}
	headers.push(...root.headers);
	const body = root.body;
	return { raw: `${headers.join("\r\n")}\r\n\r\n${body}`, messageId };
}

type MimePart = { headers: string[]; body: string };
type NormalizedAttachment = {
	filename: string;
	contentType: string;
	content: string;
	contentId: string | null;
	disposition: "attachment" | "inline";
};

function contentPart(message: SmtpMessage, boundary: string): MimePart {
	if (message.html && message.text) {
		return {
			headers: [`Content-Type: multipart/alternative; boundary="${boundary}"`],
			body: [
				`--${boundary}`,
				"Content-Type: text/plain; charset=UTF-8",
				"Content-Transfer-Encoding: 8bit",
				"",
				normalizeLines(message.text),
				`--${boundary}`,
				"Content-Type: text/html; charset=UTF-8",
				"Content-Transfer-Encoding: 8bit",
				"",
				normalizeLines(message.html),
				`--${boundary}--`,
			].join("\r\n"),
		};
	}
	if (message.html) {
		return {
			headers: ["Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: 8bit"],
			body: normalizeLines(message.html),
		};
	}
	return {
		headers: ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit"],
		body: normalizeLines(message.text || ""),
	};
}

function multipart(subtype: "mixed" | "related", boundary: string, parts: MimePart[]): MimePart {
	return {
		headers: [`Content-Type: multipart/${subtype}; boundary="${boundary}"`],
		body: [
			...parts.flatMap((part) => [`--${boundary}`, ...part.headers, "", part.body]),
			`--${boundary}--`,
		].join("\r\n"),
	};
}

function attachmentPart(attachment: NormalizedAttachment): MimePart {
	const name = filenameParameters(attachment.filename);
	return {
		headers: [
			`Content-Type: ${attachment.contentType}; ${name.type}`,
			"Content-Transfer-Encoding: base64",
			`Content-Disposition: ${attachment.disposition}; ${name.disposition}`,
			...(attachment.contentId ? [`Content-ID: <${attachment.contentId}>`] : []),
		],
		body: (attachment.content.match(/.{1,76}/g) ?? []).join("\r\n"),
	};
}

/**
 * Validates attachments before any byte reaches the SMTP session. Content must
 * be strict base64; the decoded total is bounded by EMAIL_ATTACHMENTS_MAX_BYTES.
 */
export function normalizeAttachments(
	attachments: SmtpAttachment[] | undefined,
): NormalizedAttachment[] {
	if (!attachments?.length) return [];
	if (!Array.isArray(attachments) || attachments.length > EMAIL_ATTACHMENTS_MAX_COUNT)
		throw error("email_attachments_invalid", "Too many email attachments", 422);
	let total = 0;
	const contentIds = new Set<string>();
	return attachments.map((attachment) => {
		if (!attachment || typeof attachment !== "object")
			throw error("email_attachment_invalid", "Email attachment is invalid", 422);
		const content = String(attachment.content ?? "").replace(/\s+/g, "");
		if (!content || content.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(content))
			throw error(
				"email_attachment_content_invalid",
				"Email attachment content is not base64",
				422,
			);
		total += decodedBase64Length(content);
		if (total > EMAIL_ATTACHMENTS_MAX_BYTES)
			throw error("email_attachments_too_large", "Email attachments exceed the size limit", 422);
		const disposition = attachment.disposition === "inline" ? "inline" : "attachment";
		const contentId = attachment.contentId ? sanitizeContentId(attachment.contentId) : null;
		if (disposition === "inline" && !contentId)
			throw error(
				"email_attachment_content_id_required",
				"Inline attachments need a Content-ID",
				422,
			);
		if (contentId) {
			if (contentIds.has(contentId))
				throw error("email_attachment_content_id_duplicate", "Content-ID is duplicated", 422);
			contentIds.add(contentId);
		}
		return {
			filename: sanitizeFilename(attachment.filename),
			contentType: sanitizeContentType(attachment.contentType),
			content,
			contentId,
			disposition,
		};
	});
}

export function decodedBase64Length(value: string): number {
	const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
	return Math.floor((value.length * 3) / 4) - padding;
}

/** Removes path, control, quoting and header-breaking characters from a filename. */
export function sanitizeFilename(value: unknown): string {
	let replaced = "";
	let previousUnsafe = false;
	for (const character of scalarText(value).normalize("NFC")) {
		const code = character.charCodeAt(0);
		const unsafe = code < 32 || code === 127 || UNSAFE_FILENAME_CHARACTERS.has(character);
		if (!unsafe) replaced += character;
		else if (!previousUnsafe) replaced += "_";
		previousUnsafe = unsafe;
	}
	const cleaned = replaced
		.replace(/^[.\s_]+/, "")
		.trim()
		.slice(0, 200);
	return cleaned || "attachment";
}
/** Text of a primitive header input; objects and missing values become empty. */
function scalarText(value: unknown): string {
	return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
		? String(value)
		: "";
}
const UNSAFE_FILENAME_CHARACTERS = new Set(['"', "\\", "/", ":", "*", "?", "<", ">", "|", ";"]);

export function sanitizeContentType(value: unknown): string {
	const type = scalarText(value).trim().toLowerCase();
	return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/.test(type)
		? type
		: "application/octet-stream";
}

function sanitizeContentId(value: string): string {
	const id = String(value).trim().replace(/^<|>$/g, "");
	if (!/^[A-Za-z0-9._%+-]{1,128}(?:@[A-Za-z0-9.-]{1,253})?$/.test(id))
		throw error("email_attachment_content_id_invalid", "Content-ID is invalid", 422);
	return id;
}

function filenameParameters(filename: string): { type: string; disposition: string } {
	const ascii = /^[\x20-\x7e]+$/.test(filename);
	if (ascii) return { type: `name="${filename}"`, disposition: `filename="${filename}"` };
	const fallback = filename.replace(/[^\x20-\x7e]/g, "_");
	const encoded = encodeURIComponent(filename).replace(
		/['()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return {
		type: `name="${fallback}"`,
		disposition: `filename="${fallback}"; filename*=UTF-8''${encoded}`,
	};
}

function error(code: string, message: string, status = 503, details?: Record<string, unknown>) {
	return new EmailTransportError(code, message, status, details);
}

function dotStuff(message: ReturnType<typeof buildMessage>) {
	return message.raw
		.split("\r\n")
		.map((line) => (line.startsWith(".") ? `.${line}` : line))
		.join("\r\n");
}
function normalizeLines(value: string) {
	return value.replace(/\r?\n/g, "\r\n");
}
function sanitizeMailbox(value: string) {
	const mailbox = value.trim().toLowerCase();
	if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(mailbox))
		throw error("smtp_mailbox_invalid", "SMTP mailbox is invalid", 422);
	return mailbox;
}
function sanitizeDomain(value: string) {
	return value.replace(/[^a-zA-Z0-9.-]/g, "").slice(0, 253) || "superboard.local";
}
function sanitizeHeaderName(value: string) {
	if (!/^[A-Za-z0-9-]{1,64}$/.test(value))
		throw error("email_header_invalid", "Email header name is invalid", 422);
	return value;
}
function sanitizeHeaderValue(value: string) {
	return String(value)
		.replace(/[\r\n]+/g, " ")
		.slice(0, 2_000);
}
function sanitizeMessageId(value: string) {
	const result = String(value).trim();
	if (!/^<[A-Za-z0-9._+-]{1,128}@[A-Za-z0-9.-]{1,253}>$/.test(result)) {
		throw error("email_message_id_invalid", "Email Message-ID is invalid", 422);
	}
	return result;
}
function encodeHeader(value: string) {
	return `=?UTF-8?B?${toBase64(sanitizeHeaderValue(value))}?=`;
}
function toBase64(value: string) {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}
function extractMessageId(value: string) {
	return (
		/(?:queued as|id=)\s*<?([^\s>]+)>?/iu.exec(value)?.[1] ||
		/^Ok\s+<?([^\s>]+)>?/iu.exec(value.trim())?.[1] ||
		null
	);
}

const RESERVED_MESSAGE_HEADERS = new Set([
	"date",
	"message-id",
	"from",
	"to",
	"subject",
	"reply-to",
	"mime-version",
	"content-type",
	"content-transfer-encoding",
]);
