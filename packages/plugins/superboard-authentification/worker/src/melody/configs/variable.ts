import { Role, Scope } from "@melody-auth/shared";

export enum DefaultBranding {
	FontFamily = "Inter",
	FontUrl = "https://fonts.googleapis.com/css2?family=Inter:wght@400..600&display=swap",
	LayoutColor = "lightgray",
	LabelColor = "black",
	PrimaryButtonColor = "white",
	PrimaryButtonLabelColor = LabelColor,
	PrimaryButtonBorderColor = LayoutColor,
	SecondaryButtonColor = PrimaryButtonColor,
	SecondaryButtonLabelColor = LabelColor,
	SecondaryButtonBorderColor = PrimaryButtonColor,
	CriticalIndicatorColor = "#e00",
}

export enum DefaultEnvironment {
	Development = "dev",
	Production = "prod",
}

interface OIDCProviderConfig {
	clientId: string;
	issuer: string;
	authorizeEndpoint: string;
	tokenEndpoint: string;
	jwksEndpoint: string;
	enableSignInButton: boolean;
	enableSignInRedirect: boolean;
}

export const OIDCProviderConfigs: Record<string, OIDCProviderConfig> = Object.freeze({
	Auth0: {
		clientId: "example",
		issuer: "https://dummy.us.auth0.com/",
		authorizeEndpoint: "https://dummy.us.auth0.com/authorize",
		tokenEndpoint: "https://dummy.us.auth0.com/oauth/token",
		jwksEndpoint: "https://dummy.us.auth0.com/.well-known/jwks.json",
		enableSignInButton: true,
		enableSignInRedirect: true,
	},
});

export const SocialSignInConfig = Object.freeze({
	AppleScope: "name email",
	ExternalSignInCanBypassLocalMfa: true,
});

export const RequestIPConfig = Object.freeze({
	trustedHeaders: [] as string[],
});

export const systemConfig = Object.freeze({
	name: "Melody Auth",
	emailVerificationCodeExpiresIn: 7200,
	passwordResetCodeExpiresIn: 7200,
	changeEmailVerificationCodeExpiresIn: 7200,
	emailMfaCodeExpiresIn: 300,
	invitationExpiresIn: 7,
	sendEmailToRealReceiverOnDev: false,
	enablePlainPkceMethod: false,
});

export const S2sConfig = Object.freeze({
	impersonationRoles: [Role.SuperAdmin],
	builtInRoles: [Role.SuperAdmin],
	privilegedScopes: [Scope.Root],
	builtInScopes: Object.freeze<string[]>([
		Scope.OpenId,
		Scope.Profile,
		Scope.OfflineAccess,
		Scope.Root,
		Scope.ReadUser,
		Scope.WriteUser,
		Scope.ReadApp,
		Scope.WriteApp,
		Scope.ReadRole,
		Scope.WriteRole,
		Scope.ReadScope,
		Scope.WriteScope,
	]),
});
