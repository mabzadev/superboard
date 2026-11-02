import { sha256 } from "@oslojs/crypto/sha2";
import { encodeBase64urlNoPadding } from "@oslojs/encoding";
import { z } from "zod";

import { completeInvite, InviteError, validateInvite } from "../invite.js";
import { hashToken } from "../tokens.js";
import type { AuthAdapter, User, RoleLevel } from "../types.js";
import { github, fetchGitHubEmail } from "./providers/github.js";
import { google } from "./providers/google.js";
import type { OAuthProvider, OAuthConfig, OAuthProfile, OAuthState } from "./types.js";

export { github, google };

export interface OAuthConsumerConfig {
	baseUrl: string;
	providers: {
		github?: OAuthConfig;
		google?: OAuthConfig;
	};
	canSelfSignup?: (email: string) => Promise<{ allowed: boolean; role: RoleLevel } | null>;
}

export async function createAuthorizationUrl(
	config: OAuthConsumerConfig,
	providerName: "github" | "google",
	stateStore: StateStore,
	options?: {
		inviteToken?: string;
	},
): Promise<{ url: string; state: string }> {
	const providerConfig = config.providers[providerName];
	if (!providerConfig) {
		throw new Error(`OAuth provider ${providerName} not configured`);
	}

	const provider = getProvider(providerName);
	const state = generateState();
	const redirectUri = new URL(
		`/_emdash/api/auth/oauth/${providerName}/callback`,
		config.baseUrl,
	).toString();

	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);

	await stateStore.set(state, {
		provider: providerName,
		redirectUri,
		codeVerifier,
		...(options?.inviteToken ? { inviteToken: options.inviteToken } : {}),
	});

	const url = new URL(provider.authorizeUrl);
	url.searchParams.set("client_id", providerConfig.clientId);
	url.searchParams.set("redirect_uri", redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", provider.scopes.join(" "));
	url.searchParams.set("state", state);

	url.searchParams.set("code_challenge", codeChallenge);
	url.searchParams.set("code_challenge_method", "S256");

	return { url: url.toString(), state };
}

export async function handleOAuthCallback(
	config: OAuthConsumerConfig,
	adapter: AuthAdapter,
	providerName: "github" | "google",
	code: string,
	state: string,
	stateStore: StateStore,
): Promise<User> {
	const providerConfig = config.providers[providerName];
	if (!providerConfig) {
		throw new Error(`OAuth provider ${providerName} not configured`);
	}

	const storedState = await stateStore.get(state);
	if (!storedState || storedState.provider !== providerName) {
		throw new OAuthError("invalid_state", "Invalid OAuth state");
	}

	await stateStore.delete(state);

	const provider = getProvider(providerName);

	const tokens = await exchangeCode(
		provider,
		providerConfig,
		code,
		storedState.redirectUri,
		storedState.codeVerifier,
	);

	const profile = await fetchProfile(provider, tokens.accessToken, providerName);

	if (storedState.inviteToken) {
		return acceptInviteViaOAuth(adapter, providerName, profile, storedState.inviteToken);
	}

	return findOrCreateOAuthUser(adapter, providerName, profile, config.canSelfSignup);
}

export async function acceptInviteViaOAuth(
	adapter: AuthAdapter,
	providerName: string,
	profile: OAuthProfile,
	inviteToken: string,
): Promise<User> {
	let invite: { email: string; role: RoleLevel };
	try {
		invite = await validateInvite(adapter, inviteToken);
	} catch (error) {
		if (error instanceof InviteError) {
			throw new OAuthError("invite_invalid", error.message);
		}
		throw error;
	}

	if (!profile.emailVerified) {
		throw new OAuthError(
			"invite_email_unverified",
			"Cannot accept invite: email not verified by provider",
		);
	}

	if (profile.email.toLowerCase() !== invite.email.toLowerCase()) {
		throw new OAuthError(
			"invite_email_mismatch",
			"This invite was sent to a different email address than your account.",
		);
	}

	const existingAccount = await adapter.getOAuthAccount(providerName, profile.id);
	if (existingAccount) {
		const user = await adapter.getUserById(existingAccount.userId);
		if (!user) {
			throw new OAuthError("user_not_found", "Linked user not found");
		}
		if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
			throw new OAuthError(
				"invite_email_mismatch",
				"This invite was sent to a different email address than your account.",
			);
		}
		await adapter.deleteToken(hashToken(inviteToken));
		return user;
	}

	const existingUser = await adapter.getUserByEmail(profile.email);
	if (existingUser) {
		await adapter.createOAuthAccount({
			provider: providerName,
			providerAccountId: profile.id,
			userId: existingUser.id,
		});
		await adapter.deleteToken(hashToken(inviteToken));
		return existingUser;
	}

	const user = await completeInvite(adapter, inviteToken, {
		name: profile.name ?? undefined,
		avatarUrl: profile.avatarUrl ?? undefined,
	});
	await adapter.createOAuthAccount({
		provider: providerName,
		providerAccountId: profile.id,
		userId: user.id,
	});
	return user;
}

async function exchangeCode(
	provider: OAuthProvider,
	config: OAuthConfig,
	code: string,
	redirectUri: string,
	codeVerifier?: string,
): Promise<{ accessToken: string; idToken?: string }> {
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code,
		redirect_uri: redirectUri,
		client_id: config.clientId,
		client_secret: config.clientSecret,
	});

	if (codeVerifier) {
		body.set("code_verifier", codeVerifier);
	}

	const response = await fetch(provider.tokenUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body,
	});

	if (!response.ok) {
		const error = await response.text();
		throw new OAuthError("token_exchange_failed", `Token exchange failed: ${error}`);
	}

	const json: unknown = await response.json();
	const data = z
		.object({
			access_token: z.string(),
			id_token: z.string().optional(),
		})
		.parse(json);

	return {
		accessToken: data.access_token,
		idToken: data.id_token,
	};
}

async function fetchProfile(
	provider: OAuthProvider,
	accessToken: string,
	providerName: string,
): Promise<OAuthProfile> {
	if (!provider.userInfoUrl) {
		throw new Error("Provider does not have userinfo URL");
	}

	const response = await fetch(provider.userInfoUrl, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
			"User-Agent": "emdash-cms",
		},
	});

	if (!response.ok) {
		throw new OAuthError("profile_fetch_failed", `Failed to fetch profile: ${response.status}`);
	}

	const data = await response.json();
	const profile = provider.parseProfile(data);

	if (providerName === "github" && !profile.email) {
		profile.email = await fetchGitHubEmail(accessToken);
	}

	return profile;
}

export type CanSelfSignup = (
	email: string,
) => Promise<{ allowed: boolean; role: RoleLevel } | null>;

export async function findOrCreateOAuthUser(
	adapter: AuthAdapter,
	providerName: string,
	profile: OAuthProfile,
	canSelfSignup?: CanSelfSignup,
): Promise<User> {
	const existingAccount = await adapter.getOAuthAccount(providerName, profile.id);
	if (existingAccount) {
		const user = await adapter.getUserById(existingAccount.userId);
		if (!user) {
			throw new OAuthError("user_not_found", "Linked user not found");
		}
		return user;
	}

	const existingUser = await adapter.getUserByEmail(profile.email);
	if (existingUser) {
		if (!profile.emailVerified) {
			throw new OAuthError(
				"signup_not_allowed",
				"Cannot link account: email not verified by provider",
			);
		}
		await adapter.createOAuthAccount({
			provider: providerName,
			providerAccountId: profile.id,
			userId: existingUser.id,
		});
		return existingUser;
	}

	if (canSelfSignup) {
		const signup = await canSelfSignup(profile.email);
		if (signup?.allowed) {
			const user = await adapter.createUser({
				email: profile.email,
				name: profile.name,
				avatarUrl: profile.avatarUrl,
				role: signup.role,
				emailVerified: profile.emailVerified,
			});

			await adapter.createOAuthAccount({
				provider: providerName,
				providerAccountId: profile.id,
				userId: user.id,
			});

			return user;
		}
	}

	throw new OAuthError("signup_not_allowed", "Self-signup not allowed for this email domain");
}

function getProvider(name: "github" | "google"): OAuthProvider {
	switch (name) {
		case "github":
			return github;
		case "google":
			return google;
	}
}

function generateState(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return encodeBase64urlNoPadding(bytes);
}

function generateCodeVerifier(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return encodeBase64urlNoPadding(bytes);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
	const bytes = new TextEncoder().encode(verifier);
	const hash = sha256(bytes);
	return encodeBase64urlNoPadding(hash);
}

export interface StateStore {
	set(state: string, data: OAuthState): Promise<void>;
	get(state: string): Promise<OAuthState | null>;
	delete(state: string): Promise<void>;
}

export class OAuthError extends Error {
	constructor(
		public code:
			| "invalid_state"
			| "token_exchange_failed"
			| "profile_fetch_failed"
			| "user_not_found"
			| "signup_not_allowed"
			| "invite_invalid"
			| "invite_email_mismatch"
			| "invite_email_unverified",
		message: string,
	) {
		super(message);
		this.name = "OAuthError";
	}
}
