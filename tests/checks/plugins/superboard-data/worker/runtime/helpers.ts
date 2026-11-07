import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { SELF, env } from "cloudflare:test";
import { SignJWT, importJWK, type JWK } from "jose";

export const PROJECT_ID = 12;
const INSTANCE_ID = 3;
const ORIGIN = "https://files.internal";

function isJwk(value: unknown): value is JWK & { kid: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"kty" in value &&
		"kid" in value &&
		typeof value.kid === "string"
	);
}

interface RequestOptions {
	method?: string;
	body?: unknown;
	raw?: BodyInit | null;
	headers?: Record<string, string>;
	projectId?: number;
}

async function applicationToken(
	userId: string,
	projectId = PROJECT_ID,
	expiresIn = "5m",
): Promise<string> {
	const jwk: unknown = JSON.parse(env.TEST_SIGNING_JWK);
	if (!isJwk(jwk)) throw new Error("TEST_SIGNING_JWK is not a JSON Web Key");
	return new SignJWT({ type: "application_access", pid: projectId, sid: `session-${userId}` })
		.setProtectedHeader({ alg: "ES256", kid: jwk.kid })
		.setSubject(userId)
		.setIssuer("https://sdk.example.test/v1/auth")
		.setAudience("superboard-test.application")
		.setIssuedAt()
		.setExpirationTime(expiresIn)
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

export async function sdk(
	path: string,
	options: RequestOptions & { user?: string; tokenExpiresIn?: string } = {},
) {
	const method = options.method ?? "GET";
	const headers = await contextHeaders(method, path, options.projectId ?? PROJECT_ID, false);
	if (options.user)
		headers.set(
			"authorization",
			`Bearer ${await applicationToken(options.user, PROJECT_ID, options.tokenExpiresIn)}`,
		);
	for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
	return SELF.fetch(`${ORIGIN}${path}`, { method, headers, body: body(options, headers) });
}

export async function operator(
	brick: "database" | "storage" | "functions" | "vectors",
	path: string,
	options: RequestOptions = {},
) {
	const method = options.method ?? "GET";
	const target = `/internal/v1/data/${brick}${path}`;
	const headers = await contextHeaders(method, target, options.projectId ?? PROJECT_ID, true);
	for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
	return SELF.fetch(`${ORIGIN}${target}`, {
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
	const response = await operator("database", "/keys", { method: "POST", body: { name } });
	if (response.status !== 201)
		throw new Error(`key creation failed: ${response.status} ${await response.text()}`);
	return (await response.json<{ secret: string }>()).secret;
}

export async function ensureTable(definition: Record<string, unknown>) {
	const name = String(definition.name);
	const existing = await operator("database", `/tables/${name}`);
	if (existing.status === 200) return existing.json();
	const response = await operator("database", "/tables", { method: "POST", body: definition });
	if (response.status !== 201)
		throw new Error(`table creation failed: ${response.status} ${await response.text()}`);
	return response.json();
}

export async function jsonOf<T = Record<string, unknown>>(response: Response): Promise<T> {
	return response.json<T>();
}
