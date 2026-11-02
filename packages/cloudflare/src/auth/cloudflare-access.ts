import type { AuthResult } from "emdash";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface AccessConfig {
	teamDomain: string;

	audience?: string;

	audienceEnvVar?: string;

	defaultRole?: number;

	roleMapping?: Record<string, number>;
}

export interface AccessJwtPayload extends JWTPayload {
	email: string;
}

export interface AccessGroup {
	id: string;
	name: string;
	email?: string;
}

export interface AccessIdentity {
	id: string;
	name?: string;
	email: string;
	groups: AccessGroup[];
	idp: {
		id: string;
		type: string;
	};
	oidc_fields?: Record<string, unknown>;
	saml_attributes?: Record<string, unknown>;
	geo?: {
		country: string;
	};
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const CF_AUTHORIZATION_COOKIE_REGEX = /CF_Authorization=([^;]+)/;

function getJwks(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
	let jwks = jwksCache.get(teamDomain);
	if (!jwks) {
		const jwksUrl = new URL(`https://${teamDomain}/cdn-cgi/access/certs`);
		jwks = createRemoteJWKSet(jwksUrl);
		jwksCache.set(teamDomain, jwks);
	}
	return jwks;
}

const DEFAULT_AUDIENCE_ENV_VAR = "CF_ACCESS_AUDIENCE";

function resolveAudience(config: AccessConfig): string {
	if (config.audience) {
		return config.audience;
	}

	const envVarName = config.audienceEnvVar ?? DEFAULT_AUDIENCE_ENV_VAR;
	const value = process.env[envVarName];

	if (typeof value === "string" && value) {
		return value;
	}

	throw new Error(
		`Environment variable "${envVarName}" not found or empty. ` +
			`Set it via wrangler secret, .env, or environment.`,
	);
}

export async function validateAccessJwt(
	jwt: string,
	config: AccessConfig,
): Promise<AccessJwtPayload> {
	const audience = resolveAudience(config);
	const issuer = `https://${config.teamDomain}`;
	const jwks = getJwks(config.teamDomain);

	const { payload } = await jwtVerify<AccessJwtPayload>(jwt, jwks, {
		issuer,
		audience,
		clockTolerance: 60,
	});

	return payload;
}

export function extractAccessJwt(request: Request): string | null {
	const headerJwt = request.headers.get("Cf-Access-Jwt-Assertion");
	if (headerJwt) {
		return headerJwt;
	}

	const cookies = request.headers.get("Cookie") || "";
	const match = cookies.match(CF_AUTHORIZATION_COOKIE_REGEX);
	return match?.[1] || null;
}

export async function getAccessIdentity(jwt: string, teamDomain: string): Promise<AccessIdentity> {
	const response = await fetch(`https://${teamDomain}/cdn-cgi/access/get-identity`, {
		headers: {
			Cookie: `CF_Authorization=${jwt}`,
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch identity: ${response.status}`);
	}

	return response.json();
}

export function resolveRoleFromGroups(groups: AccessGroup[], config: AccessConfig): number {
	const defaultRole = config.defaultRole ?? 30;

	if (!config.roleMapping) {
		return defaultRole;
	}

	for (const group of groups) {
		const role = config.roleMapping[group.name];
		if (role !== undefined) {
			return role;
		}
	}

	return defaultRole;
}

function isAccessConfig(value: unknown): value is AccessConfig {
	return (
		value != null &&
		typeof value === "object" &&
		"teamDomain" in value &&
		typeof value.teamDomain === "string"
	);
}

export async function authenticate(request: Request, config: unknown): Promise<AuthResult> {
	if (!isAccessConfig(config)) {
		throw new Error("Invalid Cloudflare Access config: teamDomain is required");
	}
	const accessConfig = config;

	const jwt = extractAccessJwt(request);
	if (!jwt) {
		throw new Error("No Access JWT present");
	}

	const payload = await validateAccessJwt(jwt, accessConfig);

	const identity = await getAccessIdentity(jwt, accessConfig.teamDomain);

	const role = resolveRoleFromGroups(identity.groups, accessConfig);

	console.log(
		"[cf-access] Identity from Access:",
		JSON.stringify({
			email: identity.email,
			name: identity.name,
			groups: identity.groups?.map((g) => g.name),
			idp: identity.idp,
		}),
	);

	return {
		email: identity.email,
		name: identity.name ?? identity.email.split("@")[0] ?? "Unknown",
		role,
		subject: payload.sub,
		metadata: {
			groups: identity.groups,
			idp: identity.idp,
		},
	};
}
