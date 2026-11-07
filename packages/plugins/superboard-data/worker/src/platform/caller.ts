import {
	verifyInternalProjectContextRequest,
	type InternalProjectContext,
} from "@superboard/contracts/project-context";
import { configuredSecrets } from "@superboard/contracts/secret";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { findServiceKey } from "../keys.js";
import type { DataEnv, Deferral } from "./env.js";
import { DataError } from "./http.js";

export type Role = "anon" | "authenticated" | "service";

export interface Caller {
	projectId: number;
	role: Role;
	userId: string | null;
	keyId: string | null;
	operatorId: string | null;
}

const applicationKeySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function bearerToken(request: Request): string | null {
	return request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/iu)?.[1] ?? null;
}

export async function resolveCaller(
	request: Request,
	env: DataEnv,
	deferral: Deferral,
): Promise<Caller> {
	const bearer = bearerToken(request);
	if (bearer?.startsWith("sb_secret_")) return serviceCaller(env, bearer, deferral);
	const context = await projectContext(request, env);
	if (!bearer) return caller(context.projectId, "anon", null);
	return caller(
		context.projectId,
		"authenticated",
		await verifyApplicationToken(env, bearer, context.projectId),
	);
}

export async function resolveServiceCaller(
	request: Request,
	env: DataEnv,
	deferral: Deferral,
): Promise<Caller> {
	const bearer = bearerToken(request);
	if (!bearer?.startsWith("sb_secret_"))
		throw new DataError(401, "service_key_required", "A server key is required");
	return serviceCaller(env, bearer, deferral);
}

export async function resolveOperatorCaller(request: Request, env: DataEnv): Promise<Caller> {
	const context = await projectContext(request, env);
	if (!context.operatorId)
		throw new DataError(401, "operator_context_required", "An operator session is required");
	if (!["owner", "admin"].includes(context.role))
		throw new DataError(403, "operator_required", "Owner or admin role is required");
	return {
		projectId: context.projectId,
		role: "service",
		userId: null,
		keyId: null,
		operatorId: context.operatorId,
	};
}

async function serviceCaller(env: DataEnv, secret: string, deferral: Deferral): Promise<Caller> {
	const key = await findServiceKey(env, secret, deferral);
	if (!key) throw new DataError(401, "service_key_invalid", "Server key is invalid or revoked");
	return {
		projectId: key.projectId,
		role: "service",
		userId: null,
		keyId: key.id,
		operatorId: null,
	};
}

async function projectContext(request: Request, env: DataEnv): Promise<InternalProjectContext> {
	const verified = await verifyInternalProjectContextRequest(
		request,
		configuredSecrets(env.FILES_INTERNAL_TOKEN, env.FILES_INTERNAL_TOKEN_PREVIOUS),
		"files",
	);
	if (!verified.ok)
		throw new DataError(401, "project_context_required", "SDK credentials are required");
	return verified.context;
}

async function verifyApplicationToken(
	env: DataEnv,
	token: string,
	projectId: number,
): Promise<string> {
	try {
		const verified = await jwtVerify(token, applicationKeys(env.AUTH_GATEWAY_JWKS_URL), {
			issuer: env.AUTH_GATEWAY_ISSUER,
			audience: env.APPLICATION_AUDIENCE,
			algorithms: ["ES256"],
		});
		const { sub, type, pid } = verified.payload;
		if (!sub || type !== "application_access") throw new Error("token_invalid");
		if (Number(pid) !== projectId)
			throw new DataError(401, "token_project_mismatch", "Token belongs to another project");
		return String(sub);
	} catch (cause) {
		if (cause instanceof DataError) throw cause;
		throw new DataError(401, "unauthorized", "Authentication is invalid or expired");
	}
}

function applicationKeys(url: string) {
	if (!/^https:\/\/\S+$/u.test(url)) throw new Error("AUTH_GATEWAY_JWKS_URL_invalid");
	let keys = applicationKeySets.get(url);
	if (!keys) {
		keys = createRemoteJWKSet(new URL(url), { timeoutDuration: 5_000, cooldownDuration: 30_000 });
		applicationKeySets.set(url, keys);
	}
	return keys;
}

function caller(projectId: number, role: Role, userId: string | null): Caller {
	return { projectId, role, userId, keyId: null, operatorId: null };
}
