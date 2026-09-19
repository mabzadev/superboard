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
	platform?: "web" | "desktop";
	environment?: "production" | "test";
	fetch?: typeof fetch;
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
	constructor(code: string, message: string, status?: number);
}
export class SuperBoardClient {
	constructor(options: SuperBoardClientOptions);
	readonly session: SuperBoardSession | null;
	setSession(session: SuperBoardSession): void;
	clearSession(): void;
	register(input: { email: string; password: string; name?: string }): Promise<SuperBoardSession>;
	signIn(email: string, password: string): Promise<SuperBoardSession>;
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
	request<T = unknown>(path: string, options?: SuperBoardRequestOptions): Promise<T>;
}
