import { z } from "zod";

import type { RoleName } from "./types.js";

const HTTP_SCHEME_RE = /^https?:\/\//i;

const httpUrl = z
	.string()
	.url()
	.refine((url) => HTTP_SCHEME_RE.test(url), "URL must use http or https");

const oauthProviderSchema = z.object({
	clientId: z.string(),
	clientSecret: z.string(),
});

export const authConfigSchema = z.object({
	secret: z.string().min(32, "Auth secret must be at least 32 characters"),

	passkeys: z
		.object({
			rpName: z.string(),
			rpId: z.string().optional(),
		})
		.optional(),

	selfSignup: z
		.object({
			domains: z.array(z.string()),
			defaultRole: z.enum(["subscriber", "contributor", "author"] as const).default("contributor"),
		})
		.optional(),

	oauth: z
		.object({
			github: oauthProviderSchema.optional(),
			google: oauthProviderSchema.optional(),
		})
		.optional(),

	provider: z
		.object({
			enabled: z.boolean(),
			issuer: httpUrl.optional(),
		})
		.optional(),

	sso: z
		.object({
			enabled: z.boolean(),
		})
		.optional(),

	session: z
		.object({
			maxAge: z.number().default(30 * 24 * 60 * 60),
			sliding: z.boolean().default(true),
		})
		.optional(),
});

export type AuthConfig = z.infer<typeof authConfigSchema>;

export interface ResolvedAuthConfig {
	secret: string;
	baseUrl: string;
	siteName: string;

	passkeys: {
		rpName: string;
		rpId: string;
		origin: string;
	};

	selfSignup?: {
		domains: string[];
		defaultRole: RoleName;
	};

	oauth?: {
		github?: {
			clientId: string;
			clientSecret: string;
		};
		google?: {
			clientId: string;
			clientSecret: string;
		};
	};

	provider?: {
		enabled: boolean;
		issuer: string;
	};

	sso?: {
		enabled: boolean;
	};

	session: {
		maxAge: number;
		sliding: boolean;
	};
}

const selfSignupRoleMap: Record<"subscriber" | "contributor" | "author", RoleName> = {
	subscriber: "SUBSCRIBER",
	contributor: "CONTRIBUTOR",
	author: "AUTHOR",
};

export function resolveConfig(
	config: AuthConfig,
	baseUrl: string,
	siteName: string,
): ResolvedAuthConfig {
	const url = new URL(baseUrl);

	return {
		secret: config.secret,
		baseUrl,
		siteName,

		passkeys: {
			rpName: config.passkeys?.rpName ?? siteName,
			rpId: config.passkeys?.rpId ?? url.hostname,
			origin: url.origin,
		},

		selfSignup: config.selfSignup
			? {
					domains: config.selfSignup.domains.map((d) => d.toLowerCase()),
					defaultRole: selfSignupRoleMap[config.selfSignup.defaultRole],
				}
			: undefined,

		oauth: config.oauth,

		provider: config.provider
			? {
					enabled: config.provider.enabled,
					issuer: config.provider.issuer ?? baseUrl,
				}
			: undefined,

		sso: config.sso,

		session: {
			maxAge: config.session?.maxAge ?? 30 * 24 * 60 * 60,
			sliding: config.session?.sliding ?? true,
		},
	};
}
