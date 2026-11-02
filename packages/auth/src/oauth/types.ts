export interface OAuthProfile {
	id: string;
	email: string;
	name: string | null;
	avatarUrl: string | null;
	emailVerified: boolean;
}

export interface OAuthProvider {
	name: string;
	authorizeUrl: string;
	tokenUrl: string;
	userInfoUrl?: string;
	scopes: string[];

	parseProfile(data: unknown): OAuthProfile;
}

export interface OAuthConfig {
	clientId: string;
	clientSecret: string;
}

export interface OAuthState {
	provider: string;
	redirectUri: string;
	codeVerifier?: string;
	nonce?: string;
	inviteToken?: string;
}
