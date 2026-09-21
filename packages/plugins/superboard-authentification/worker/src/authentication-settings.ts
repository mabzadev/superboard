import {
	authenticationSettingsFromEnvironment,
	validateAuthenticationSettings,
	AuthenticationSettingsError,
	type AuthenticationSettings,
} from "@superboard/contracts/authentication-settings";
import { readJsonObjectLimited, RequestBodyError } from "@superboard/contracts/request-body";

import type { IdentityEnv } from "./types.js";

interface ConfigurationRow {
	revision: number;
	values_json: string;
	updated_at: string;
}

async function storedConfiguration(env: IdentityEnv) {
	const realm = env.IDENTITY_REALM || "reference-production";
	const row = await env.DB.prepare(
		"SELECT revision,values_json,updated_at FROM identity_configuration WHERE realm=?",
	)
		.bind(realm)
		.first<ConfigurationRow>();
	return {
		revision: row?.revision ?? 0,
		values: row ? validateAuthenticationSettings(JSON.parse(row.values_json)) : {},
		updatedAt: row?.updated_at ?? null,
	};
}

export async function configuredIdentityEnvironment(env: IdentityEnv): Promise<IdentityEnv> {
	const configuration = await storedConfiguration(env);
	const values = configuration.values;
	return {
		...env,
		...values,
		...(typeof values.ENABLE_SIGN_UP === "boolean"
			? { REGISTRATION_MODE: values.ENABLE_SIGN_UP ? "open" : "closed" }
			: {}),
	};
}

export function requiresHostedSignIn(env: IdentityEnv): boolean {
	return (
		env.OTP_MFA_IS_REQUIRED ||
		env.EMAIL_MFA_IS_REQUIRED ||
		env.SMS_MFA_IS_REQUIRED ||
		(env.ENFORCE_ONE_MFA_ENROLLMENT ?? []).some((method) => method !== "__none__")
	);
}

export async function authenticationSettingsResponse(
	request: Request,
	env: IdentityEnv,
	operatorId?: string,
): Promise<Response> {
	try {
		if (request.method !== "GET" && request.method !== "PUT")
			return reply({ error: { code: "method_not_allowed" } }, 405);
		if (request.method === "PUT" && !operatorId)
			return reply({ error: { code: "operator_required" } }, 403);
		const current = await storedConfiguration(env);
		if (request.method === "GET")
			return reply({
				...current,
				serverUrl: env.AUTH_SERVER_URL,
				values: { ...authenticationSettingsFromEnvironment(env), ...current.values },
			});
		const body = await readJsonObjectLimited(request, 32768);
		if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0)
			return reply({ error: { code: "configuration_invalid", field: "revision" } }, 422);
		if (body.revision !== current.revision)
			return reply({ error: { code: "configuration_conflict" } }, 409);
		const changes = validateAuthenticationSettings(body.values);
		const values: AuthenticationSettings = { ...current.values, ...changes };
		const revision = current.revision + 1;
		const now = new Date().toISOString();
		const operation = crypto.randomUUID();
		const results = await env.DB.batch([
			env.DB.prepare(`INSERT INTO identity_configuration (realm,revision,values_json,operation_id,updated_at)
			 VALUES (?,?,?,?,?) ON CONFLICT(realm) DO UPDATE SET revision=excluded.revision,values_json=excluded.values_json,operation_id=excluded.operation_id,updated_at=excluded.updated_at
			 WHERE identity_configuration.revision=?`).bind(
				env.IDENTITY_REALM,
				revision,
				JSON.stringify(values),
				operation,
				now,
				current.revision,
			),
			env.DB.prepare(`INSERT INTO identity_configuration_history (realm,revision,values_json,operator_id,operation_id,created_at)
			 SELECT realm,revision,values_json,?,operation_id,updated_at FROM identity_configuration WHERE realm=? AND operation_id=?`).bind(
				operatorId ?? "",
				env.IDENTITY_REALM,
				operation,
			),
			env.DB.prepare(`INSERT INTO identity_event_outbox (id,event_type,aggregate_id,payload_json)
			 SELECT operation_id,'identity.configuration.updated',realm,? FROM identity_configuration WHERE realm=? AND operation_id=?`).bind(
				JSON.stringify({
					realm: env.IDENTITY_REALM,
					revision,
					operatorId,
					changedKeys: Object.keys(changes),
				}),
				env.IDENTITY_REALM,
				operation,
			),
		]);
		if (!results[0]?.meta.changes) return reply({ error: { code: "configuration_conflict" } }, 409);
		return reply({
			revision,
			serverUrl: env.AUTH_SERVER_URL,
			values: { ...authenticationSettingsFromEnvironment(env), ...values },
			updatedAt: now,
		});
	} catch (cause) {
		if (cause instanceof AuthenticationSettingsError)
			return reply({ error: { code: "configuration_invalid", field: cause.field } }, 422);
		if (cause instanceof RequestBodyError)
			return reply({ error: { code: cause.code } }, cause.status);
		console.error("[identity-configuration] Request failed");
		return reply({ error: { code: "configuration_unavailable" } }, 503);
	}
}

function reply(data: unknown, status = 200) {
	return Response.json(data, {
		status,
		headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
	});
}
