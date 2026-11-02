import type { AuthProviderDescriptor } from "emdash";

export interface AtprotoAuthConfig {
	allowedDIDs?: string[];

	allowedHandles?: string[];

	defaultRole?: number;
}

export function atproto(config?: AtprotoAuthConfig): AuthProviderDescriptor {
	return {
		id: "atproto",
		label: "Atmosphere",
		config: config ?? {},
		adminEntry: "@emdash-cms/auth-atproto/admin",
		routes: [
			{
				pattern: "/_emdash/api/auth/atproto/login",
				entrypoint: "@emdash-cms/auth-atproto/routes/login.ts",
			},
			{
				pattern: "/_emdash/api/auth/atproto/callback",
				entrypoint: "@emdash-cms/auth-atproto/routes/callback.ts",
			},
			{
				pattern: "/_emdash/api/setup/atproto-admin",
				entrypoint: "@emdash-cms/auth-atproto/routes/setup-admin.ts",
			},
			{
				pattern: "/.well-known/atproto-client-metadata.json",
				entrypoint: "@emdash-cms/auth-atproto/routes/client-metadata.ts",
			},
		],
		publicRoutes: ["/_emdash/api/auth/atproto/"],
		storage: {
			states: { indexes: [] },
			sessions: { indexes: [] },
		},
	};
}
