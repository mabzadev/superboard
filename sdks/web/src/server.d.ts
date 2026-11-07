import { SuperBoardError } from "./client.js";
import type {
	AiClient,
	Bucket,
	FunctionsClient,
	QueryBuilder,
	RequestSignal,
	Row,
	StorageClient,
	VectorsClient,
} from "./data.js";

export { SuperBoardError };
export type * from "./data.js";

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

export type AccessRule = "public" | "authenticated" | "owner" | "service";
export type ColumnType = "text" | "integer" | "number" | "boolean" | "json" | "timestamp" | "uuid";
export interface ColumnInput {
	name: string;
	type: ColumnType;
	nullable?: boolean;
	default?: unknown;
	unique?: boolean;
	indexed?: boolean;
}
export interface TableInput {
	name: string;
	label?: string | null;
	rules?: Partial<Record<"read" | "insert" | "update" | "delete", AccessRule>>;
	realtime?: boolean;
	columns?: ColumnInput[];
}
export interface TableDefinition {
	name: string;
	label: string | null;
	rules: Record<"read" | "insert" | "update" | "delete", AccessRule>;
	realtime: boolean;
	columns: (Required<Omit<ColumnInput, "default">> & { default: unknown; position: number })[];
	created_at: string;
	updated_at: string;
	row_count?: number;
}
export interface SchemaInput {
	tables: TableInput[];
	/** Drop tables that the schema does not declare. */
	prune?: boolean;
}
export interface SchemaChange {
	action:
		| "create_table"
		| "update_table"
		| "drop_table"
		| "add_column"
		| "update_column"
		| "drop_column";
	table: string;
	column?: string;
	destructive: boolean;
}
export interface SchemaPlan {
	changes: SchemaChange[];
	applied: boolean;
}
export interface FunctionDeployInput extends RequestSignal {
	source?: string;
	access?: "public" | "authenticated" | "service";
	timeoutMs?: number;
	vars?: Record<string, string>;
	/** A null value removes the secret. */
	secrets?: Record<string, string | null>;
}
export interface FunctionTestResult {
	run_id: string;
	status: number;
	headers: Record<string, string>;
	body: string;
	logs: unknown[];
	duration_ms: number;
}
export interface ProjectStatus {
	project_id: number;
	features: Record<
		"realtime" | "functions" | "function_secrets" | "image_transformations" | "vectors",
		boolean
	>;
	counts: { tables: number; buckets: number; functions: number };
}
type Json = Record<string, unknown>;

export interface SuperBoardAdminOptions {
	apiUrl: string;
	/** Server key `sb_secret_…` created in the Front. */
	secretKey: string;
	/** Numeric project id; needed by `getPublicUrl()`. */
	projectId?: number | string;
	fetch?: typeof fetch;
	/** Per-request timeout; 60 s by default, 0 disables it. */
	timeoutMs?: number;
	dangerouslyAllowBrowser?: boolean;
}

export class ManagementClient {
	private constructor();
	status(options?: RequestSignal): Promise<ProjectStatus>;
	types(options?: RequestSignal): Promise<string>;
	openapi(options?: RequestSignal): Promise<Json>;
	readonly tables: {
		list(options?: RequestSignal): Promise<{ items: TableDefinition[] }>;
		get(table: string, options?: RequestSignal): Promise<TableDefinition>;
		create(definition: TableInput, options?: RequestSignal): Promise<TableDefinition>;
		update(
			table: string,
			changes: Pick<TableInput, "label" | "rules" | "realtime">,
			options?: RequestSignal,
		): Promise<TableDefinition>;
		delete(table: string, options?: RequestSignal): Promise<{ deleted: true }>;
		addColumn(table: string, column: ColumnInput, options?: RequestSignal): Promise<Json>;
		updateColumn(
			table: string,
			column: string,
			changes: Partial<Omit<ColumnInput, "name" | "type">>,
			options?: RequestSignal,
		): Promise<Json>;
		dropColumn(table: string, column: string, options?: RequestSignal): Promise<Json>;
	};
	readonly schema: {
		/** The current tables in the shape accepted by `push()`. */
		pull(options?: RequestSignal): Promise<SchemaInput>;
		push(
			schema: SchemaInput,
			options?: { dryRun?: boolean; allowDestructive?: boolean; prune?: boolean } & RequestSignal,
		): Promise<SchemaPlan>;
	};
	readonly buckets: {
		list(options?: RequestSignal): Promise<{ items: Bucket[] }>;
		create(bucket: Json & { name: string }, options?: RequestSignal): Promise<Bucket>;
		update(bucket: string, changes: Json, options?: RequestSignal): Promise<Bucket>;
		delete(bucket: string, options?: RequestSignal): Promise<{ deleted: true }>;
	};
	readonly functions: {
		list(options?: RequestSignal): Promise<{ items: Json[] }>;
		get(name: string, options?: RequestSignal): Promise<Json>;
		deploy(name: string, input: FunctionDeployInput): Promise<Json>;
		delete(name: string, options?: RequestSignal): Promise<{ deleted: true }>;
		rollback(name: string, version: number, options?: RequestSignal): Promise<Json>;
		runs(name: string, options?: { limit?: number } & RequestSignal): Promise<{ items: Json[] }>;
		schedule(
			name: string,
			cron: string,
			options?: { enabled?: boolean } & RequestSignal,
		): Promise<{ cron: string; enabled: boolean; next_run_at: string; last_run_at: string | null }>;
		unschedule(name: string, options?: RequestSignal): Promise<{ deleted: true }>;
		/** Runs the function with the operator test trigger and returns its logs. */
		test(
			name: string,
			input?: {
				method?: string;
				path?: string;
				body?: unknown;
				headers?: Record<string, string>;
			} & RequestSignal,
		): Promise<FunctionTestResult>;
	};
	readonly vectorCollections: {
		list(options?: RequestSignal): Promise<{ items: Json[]; available: boolean }>;
		create(
			collection: { name: string; rules?: Partial<Record<"read" | "write", AccessRule>> },
			options?: RequestSignal,
		): Promise<Json>;
		update(
			collection: string,
			changes: { rules?: Partial<Record<"read" | "write", AccessRule>> },
			options?: RequestSignal,
		): Promise<Json>;
		delete(collection: string, options?: RequestSignal): Promise<{ deleted: true }>;
	};
	readonly settings: {
		get(options?: RequestSignal): Promise<Json>;
		update(changes: Json, options?: RequestSignal): Promise<Json>;
	};
}

export class SuperBoardAdmin {
	constructor(options: SuperBoardAdminOptions);
	from<T extends Record<string, unknown> = Row>(table: string): QueryBuilder<T>;
	readonly storage: StorageClient;
	readonly functions: FunctionsClient;
	readonly vectors: VectorsClient;
	readonly ai: AiClient;
	readonly manage: ManagementClient;
	readonly realtime: {
		broadcast(
			channel: string,
			event: string,
			payload?: unknown,
			options?: RequestSignal,
		): Promise<{ delivered: number }>;
	};
}
export function schemaFromTables(tables: TableDefinition[]): SchemaInput;
