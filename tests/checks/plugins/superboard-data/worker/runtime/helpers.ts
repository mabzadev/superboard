import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { SELF, env } from "cloudflare:test";
import { SignJWT, importJWK, type JWK } from "jose";

export const PROJECT_ID = 12;
export const INSTANCE_ID = 3;
const ORIGIN = "https://files.internal";

export interface RequestOptions {
	method?: string;
	body?: unknown;
	raw?: BodyInit | null;
	headers?: Record<string, string>;
	projectId?: number;
}

export async function applicationToken(userId: string, projectId = PROJECT_ID): Promise<string> {
	const jwk = JSON.parse(env.TEST_SIGNING_JWK) as JWK;
	return new SignJWT({ type: "application_access", pid: projectId, sid: `session-${userId}` })
		.setProtectedHeader({ alg: "ES256", kid: jwk.kid })
		.setSubject(userId)
		.setIssuer("https://sdk.example.test/v1/auth")
		.setAudience("superboard-test.application")
		.setIssuedAt()
		.setExpirationTime("5m")
		.sign(await importJWK(jwk, "ES256"));
}

async function contextHeaders(method: string, path: string, projectId: number, operator: boolean) {
	return createProjectContextHeaders(
		{
			projectId,
			projectRef: `${INSTANCE_ID}-prod`,
			instanceId: INSTANCE_ID,
			environment: "production",
			actorId: 0,
			...(operator ? { operatorId: "operator-1" } : {}),
			role: operator ? "owner" : "sdk",
			requestId: crypto.randomUUID(),
			issuedAt: Math.floor(Date.now() / 1000),
			module: "files",
			method,
			pathname: new URL(path, ORIGIN).pathname,
		},
		env.FILES_INTERNAL_TOKEN,
	);
}

function body(options: RequestOptions, headers: Headers): BodyInit | null {
	if (options.raw !== undefined) return options.raw;
	if (options.body === undefined) return null;
	headers.set("content-type", "application/json");
	return JSON.stringify(options.body);
}

export async function sdk(path: string, options: RequestOptions & { user?: string } = {}) {
	const method = options.method ?? "GET";
	const headers = await contextHeaders(method, path, options.projectId ?? PROJECT_ID, false);
	if (options.user) headers.set("authorization", `Bearer ${await applicationToken(options.user)}`);
	for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
	return SELF.fetch(`${ORIGIN}${path}`, { method, headers, body: body(options, headers) });
}

export async function operator(path: string, options: RequestOptions = {}) {
	const method = options.method ?? "GET";
	const headers = await contextHeaders(
		method,
		`/internal/v1/operator/data${path}`,
		options.projectId ?? PROJECT_ID,
		true,
	);
	for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
	return SELF.fetch(`${ORIGIN}/internal/v1/operator/data${path}`, {
		method,
		headers,
		body: body(options, headers),
	});
}

export async function service(path: string, secret: string, options: RequestOptions = {}) {
	const headers = new Headers({ authorization: `Bearer ${secret}`, ...options.headers });
	return SELF.fetch(`${ORIGIN}${path}`, {
		method: options.method ?? "GET",
		headers,
		body: body(options, headers),
	});
}

export async function publicRequest(path: string, init: RequestInit = {}) {
	return SELF.fetch(`${ORIGIN}${path}`, init);
}

export async function createKey(name = "server"): Promise<string> {
	const response = await operator("/keys", { method: "POST", body: { name } });
	if (response.status !== 201)
		throw new Error(`key creation failed: ${response.status} ${await response.text()}`);
	return ((await response.json()) as { secret: string }).secret;
}

export async function ensureTable(definition: Record<string, unknown>) {
	const name = String(definition.name);
	const existing = await operator(`/tables/${name}`);
	if (existing.status === 200) return existing.json();
	const response = await operator("/tables", { method: "POST", body: definition });
	if (response.status !== 201)
		throw new Error(`table creation failed: ${response.status} ${await response.text()}`);
	return response.json();
}

export async function jsonOf<T = Record<string, unknown>>(response: Response): Promise<T> {
	return (await response.json()) as T;
}
