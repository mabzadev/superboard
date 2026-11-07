import type {
	AiClient,
	FunctionsClient,
	QueryBuilder,
	Row,
	StorageClient,
	VectorsClient,
} from "./data.js";
import type {
	ChannelOptions,
	RealtimeChannel,
	RealtimeClient,
	RealtimeOptions,
} from "./realtime.js";

export type * from "./data.js";
export type * from "./realtime.js";

export interface SuperBoardSession {
	access_token: string;
	refresh_token: string;
	expires_in?: number;
	user_id?: string;
	[key: string]: unknown;
}
export interface SuperBoardClientOptions {
	apiUrl: string;
	projectKey: string;
	appId: string;
	appVersion?: string;
	language?: string;
	platform?: "web" | "desktop";
	environment?: "production" | "test";
	fetch?: typeof fetch;
	/** Numeric project id shown in the Front; needed by `getPublicUrl()`. */
	projectId?: number | string;
	/** Timeout of data, storage, functions and vectors requests. */
	timeoutMs?: number;
	WebSocket?: RealtimeOptions["WebSocket"];
	realtime?: Omit<RealtimeOptions, "WebSocket">;
}
export interface CaptchaOptions {
	captchaToken?: string;
}
export interface SuperBoardRequestOptions {
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
	body?: unknown;
	authenticated?: boolean;
	applicationToken?: boolean;
	idempotencyKey?: string;
	signal?: AbortSignal;
}
export class SuperBoardError extends Error {
	code: string;
	status: number;
	details?: unknown;
	retryable: boolean;
	/** Set by `uploadLarge()` failures so the upload can be resumed. */
	uploadId?: string;
	constructor(
		code: string,
		message: string,
		status?: number,
		details?: unknown,
		retryable?: boolean,
	);
}
export class SuperBoardClient {
	constructor(options: SuperBoardClientOptions);
	readonly session: SuperBoardSession | null;
	setSession(session: SuperBoardSession): void;
	clearSession(): void;
	register(
		input: { email: string; password: string; name?: string },
		options?: CaptchaOptions,
	): Promise<SuperBoardSession>;
	signIn(email: string, password: string, options?: CaptchaOptions): Promise<SuperBoardSession>;
	signInAnonymously(installationId: string): Promise<SuperBoardSession>;
	signInWithProvider(
		provider: "google" | "apple",
		input: Record<string, unknown>,
	): Promise<SuperBoardSession>;
	getProfile<T = Record<string, unknown>>(): Promise<T>;
	updateProfile<T = Record<string, unknown>>(profile: Record<string, unknown>): Promise<T>;
	refreshSession(): Promise<SuperBoardSession>;
	logout(): Promise<void>;
	getApplicationAccessToken(): Promise<string>;
	getPurchaseOfferings(placement?: string): Promise<Record<string, unknown>>;
	getPurchaseCustomerInfo(): Promise<Record<string, unknown>>;
	createCheckoutSession(
		input: { product_id: string; success_url: string; cancel_url: string },
		idempotencyKey?: string,
	): Promise<{ id: string; url: string }>;
	createBillingPortalSession(returnUrl: string): Promise<{ url: string }>;
	request<T = unknown>(path: string, options?: SuperBoardRequestOptions): Promise<T>;
	from<T extends Record<string, unknown> = Row>(table: string): QueryBuilder<T>;
	readonly storage: StorageClient;
	readonly functions: FunctionsClient;
	readonly vectors: VectorsClient;
	readonly ai: AiClient;
	readonly realtime: RealtimeClient;
	channel(name: string, options?: ChannelOptions): RealtimeChannel;
}
