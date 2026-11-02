export interface SuperBoardServerOptions {
	apiUrl: string;
	secretKey: string;
	fetch?: typeof fetch;
	timeoutMs?: number;
	dangerouslyAllowBrowser?: boolean;
}
export type EmailAddress = string | { email: string; name?: string };
export interface EmailAttachment {
	filename: string;
	content: string | Uint8Array | ArrayBuffer;
	contentType?: string;
	contentId?: string;
	disposition?: "attachment" | "inline";
}
export interface SendEmailInput {
	to: EmailAddress | EmailAddress[];
	from: EmailAddress;
	subject?: string;
	html?: string;
	text?: string;
	templateId?: string;
	variables?: Record<string, unknown>;
	locale?: string;
	replyTo?: string;
	headers?: Record<string, string>;
	tags?: string[];
	metadata?: Record<string, unknown>;
	attachments?: EmailAttachment[];
	scheduledAt?: Date | string;
	idempotencyKey?: string;
}
export interface SendEmailResult {
	id: string;
	status: "queued" | "scheduled" | "captured";
	scheduled_at: string | null;
	recipients?: number;
	suppressed?: string[];
	replayed?: boolean;
}
export interface EmailStatus {
	id: string;
	status: "queued" | "scheduled" | "sending" | "sent" | "failed" | "canceled" | "captured";
	subject: string;
	from: string;
	created_at: string;
	sent_at: string | null;
	scheduled_at: string | null;
	canceled_at: string | null;
	tags: string[];
	recipients: Array<{ recipient: string; status: string; provider_status: string | null }>;
	events: Array<{
		type: string;
		recipient: string | null;
		occurred_at: string;
		detail: Record<string, unknown>;
	}>;
}
export interface RequestOptions {
	idempotencyKey?: string;
	signal?: AbortSignal;
}
export class SuperBoardEmailError extends Error {
	code: string;
	status: number;
	details?: unknown;
	retryable: boolean;
	constructor(
		code: string,
		message: string,
		status?: number,
		details?: unknown,
		retryable?: boolean,
	);
}
export class SuperBoardServer {
	constructor(options: SuperBoardServerOptions);
	sendEmail(input: SendEmailInput, options?: RequestOptions): Promise<SendEmailResult>;
	getEmail(id: string, options?: { signal?: AbortSignal }): Promise<EmailStatus>;
	cancelEmail(
		id: string,
		options?: { signal?: AbortSignal },
	): Promise<{ id: string; status: "canceled"; canceled_at: string }>;
}
export function sendEmail(
	options: SuperBoardServerOptions,
	input: SendEmailInput,
	requestOptions?: RequestOptions,
): Promise<SendEmailResult>;
export function verifyWebhookSignature(input: {
	payload: string;
	signature: string | null;
	timestamp: string | null;
	secret: string;
	toleranceSeconds?: number;
	now?: number;
}): Promise<boolean>;
