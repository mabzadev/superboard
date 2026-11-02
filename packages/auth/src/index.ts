export * from "./types.js";

import { authConfigSchema as _authConfigSchema } from "./config.js";
export {
	authConfigSchema,
	resolveConfig,
	type AuthConfig,
	type ResolvedAuthConfig,
} from "./config.js";

export {
	Permissions,
	hasPermission,
	requirePermission,
	canActOnOwn,
	requirePermissionOnResource,
	PermissionError,
	scopesForRole,
	clampScopes,
	type Permission,
} from "./rbac.js";

export {
	generateToken,
	hashToken,
	generateTokenWithHash,
	generateSessionId,
	generateAuthSecret,
	secureCompare,
	encrypt,
	decrypt,
	TOKEN_PREFIXES,
	generatePrefixedToken,
	hashPrefixedToken,
	VALID_SCOPES,
	validateScopes,
	isValidScope,
	hasScope,
	type ApiTokenScope,
	computeS256Challenge,
} from "./tokens.js";

export * from "./passkey/index.js";

export {
	sendMagicLink,
	verifyMagicLink,
	MagicLinkError,
	type MagicLinkConfig,
} from "./magic-link/index.js";

export {
	requestAdminEmailSetup,
	completeAdminEmailSetup,
	AdminEmailSetupError,
	type AdminEmailSetupConfig,
	type AdminEmailSetupSendFn,
} from "./setup-email.js";

export {
	createInvite,
	createInviteToken,
	validateInvite,
	completeInvite,
	InviteError,
	escapeHtml,
	type InviteConfig,
	type InviteTokenResult,
	type EmailSendFn,
} from "./invite.js";

export {
	canSignup,
	requestSignup,
	validateSignupToken,
	completeSignup,
	SignupError,
	type SignupConfig,
} from "./signup.js";

export {
	createAuthorizationUrl,
	handleOAuthCallback,
	findOrCreateOAuthUser,
	acceptInviteViaOAuth,
	OAuthError,
	github,
	google,
	type CanSelfSignup,
	type StateStore,
	type OAuthConsumerConfig,
} from "./oauth/consumer.js";
export type { OAuthProvider, OAuthConfig, OAuthProfile, OAuthState } from "./oauth/types.js";

export type { EmailAdapter, EmailMessage } from "./types.js";

export function auth(config: import("./config.js").AuthConfig): import("./config.js").AuthConfig {
	const result = _authConfigSchema.safeParse(config);
	if (!result.success) {
		throw new Error(`Invalid auth config: ${result.error.message}`);
	}
	return result.data;
}
