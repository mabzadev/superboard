import { createFrontI18n } from "@superboard/front-ui/i18n";

const labels: Record<string, [string, string]> = {
	COMPANY_LOGO_URL: ["Sign-in page logo", "Logo de la page de connexion"],
	COMPANY_EMAIL_LOGO_URL: ["Email logo", "Logo des e-mails"],
	EMAIL_SENDER_NAME: ["Email sender name", "Nom de l’expéditeur des e-mails"],
	TERMS_LINK: ["Terms URL", "Lien des conditions d’utilisation"],
	PRIVACY_POLICY_LINK: ["Privacy policy URL", "Lien de la politique de confidentialité"],
	SUPPORTED_LOCALES: ["Available languages", "Langues disponibles"],
	ENABLE_LOCALE_SELECTOR: ["Show the language selector", "Afficher le choix de langue"],
	ENABLE_NAMES: ["Ask for first and last name", "Demander le prénom et le nom"],
	NAMES_IS_REQUIRED: ["Require a name", "Rendre le nom obligatoire"],
	ENABLE_SIGN_UP: ["Allow registration", "Autoriser les inscriptions"],
	ENABLE_PASSWORD_SIGN_IN: ["Allow password sign-in", "Autoriser la connexion par mot de passe"],
	ENABLE_PASSWORDLESS_SIGN_IN: [
		"Allow passwordless sign-in",
		"Autoriser la connexion sans mot de passe",
	],
	USE_PASSWORDLESS_AS_MAGIC_LINK: [
		"Send a sign-in link instead of a code",
		"Envoyer un lien de connexion au lieu d’un code",
	],
	ENABLE_EMAIL_VERIFICATION: ["Verify email addresses", "Vérifier les adresses e-mail"],
	REPLACE_EMAIL_VERIFICATION_WITH_WELCOME_EMAIL: [
		"Send a welcome email instead of verification",
		"Remplacer la vérification par un e-mail de bienvenue",
	],
	ENABLE_PASSWORD_RESET: ["Allow password reset", "Autoriser la réinitialisation du mot de passe"],
	ENABLE_USER_APP_CONSENT: [
		"Ask for application consent",
		"Demander le consentement à l’application",
	],
	ENABLE_USER_ATTRIBUTE: [
		"Enable custom user attributes",
		"Activer les attributs utilisateur personnalisés",
	],
	BLOCKED_POLICIES: ["Your users can", "Vos utilisateurs peuvent"],
	AUTHORIZATION_CODE_EXPIRES_IN: ["Authorization code lifetime", "Durée du code d’autorisation"],
	SPA_ACCESS_TOKEN_EXPIRES_IN: [
		"Application access token lifetime",
		"Durée du jeton d’accès des applications",
	],
	SPA_REFRESH_TOKEN_EXPIRES_IN: ["Refresh token lifetime", "Durée du jeton de renouvellement"],
	S2S_ACCESS_TOKEN_EXPIRES_IN: ["Server access token lifetime", "Durée du jeton d’accès serveur"],
	ID_TOKEN_EXPIRES_IN: ["Identity token lifetime", "Durée du jeton d’identité"],
	SERVER_SESSION_EXPIRES_IN: ["Session lifetime", "Durée de la session"],
	OTP_MFA_IS_REQUIRED: [
		"Require an authenticator app",
		"Exiger une application d’authentification",
	],
	EMAIL_MFA_IS_REQUIRED: [
		"Require email verification at sign-in",
		"Exiger un code e-mail à la connexion",
	],
	ENFORCE_ONE_MFA_ENROLLMENT: [
		"Ask users to set up at least one of these methods",
		"Demander de configurer au moins une de ces méthodes",
	],
	ALLOW_EMAIL_MFA_AS_BACKUP: [
		"Allow email as a backup verification method",
		"Autoriser l’e-mail comme méthode de secours",
	],
	ALLOW_PASSKEY_ENROLLMENT: ["Allow passkeys", "Autoriser les clés d’accès"],
	ENABLE_RECOVERY_CODE: ["Enable recovery codes", "Activer les codes de récupération"],
	ENABLE_MFA_REMEMBER_DEVICE: ["Allow trusted devices", "Mémoriser les appareils de confiance"],
	ACCOUNT_LOCKOUT_THRESHOLD: ["Failed attempts before lockout", "Échecs avant blocage"],
	ACCOUNT_LOCKOUT_EXPIRES_IN: ["Lockout duration", "Durée du blocage"],
	UNLOCK_ACCOUNT_VIA_PASSWORD_RESET: [
		"Unlock accounts through password reset",
		"Débloquer le compte par réinitialisation du mot de passe",
	],
	PASSWORD_RESET_EMAIL_THRESHOLD: [
		"Password reset email limit",
		"Limite d’e-mails de réinitialisation",
	],
	PASSWORD_RESET_CODE_THRESHOLD: [
		"Password reset code attempt limit",
		"Limite d’essais du code de réinitialisation",
	],
	CHANGE_EMAIL_EMAIL_THRESHOLD: [
		"Email change message limit",
		"Limite d’envois pour changer d’e-mail",
	],
	CHANGE_EMAIL_CODE_THRESHOLD: [
		"Email change code attempt limit",
		"Limite d’essais du code de changement d’e-mail",
	],
	EMAIL_VERIFICATION_CODE_THRESHOLD: [
		"Email verification attempt limit",
		"Limite d’essais de vérification d’e-mail",
	],
	EMAIL_MFA_EMAIL_THRESHOLD: [
		"Sign-in verification email limit",
		"Limite d’e-mails de vérification de connexion",
	],
	MFA_CODE_VERIFY_THRESHOLD: [
		"Verification code attempt limit",
		"Limite d’essais des codes de vérification",
	],
	AUTH_CODE_VERIFIER_THRESHOLD: [
		"Authorization code attempt limit",
		"Limite d’essais du code d’autorisation",
	],
	GOOGLE_AUTH_CLIENT_ID: ["Google client ID", "Identifiant client Google"],
	GITHUB_AUTH_CLIENT_ID: ["GitHub client ID", "Identifiant client GitHub"],
	GITHUB_AUTH_APP_NAME: ["GitHub application name", "Nom de l’application GitHub"],
	APPLE_AUTH_CLIENT_ID: ["Apple client ID", "Identifiant client Apple"],
	OIDC_AUTH_PROVIDERS: ["OIDC provider names", "Noms des fournisseurs OIDC"],
	ENABLE_EMAIL_LOG: ["Keep email logs", "Journaliser les e-mails"],
	ENABLE_SIGN_IN_LOG: ["Keep sign-in logs", "Journaliser les connexions"],
	ENABLE_CAPTCHA: ["CAPTCHA (Turnstile)", "CAPTCHA (Turnstile)"],
	TURNSTILE_SITE_KEY: ["Site key", "Clé de site"],
};
const messages: Record<string, [string, string]> = {
	"tab:sign-in": ["Sign-in", "Connexion"],
	"tab:access": ["Access control", "Contrôle d’accès"],
	"tab:fields": ["Users & fields", "Utilisateurs et champs"],
	"tab:appearance": ["Appearance", "Apparence"],
	"tab:advanced": ["Advanced", "Avancé"],
	"tab:configuration": ["Configuration", "Configuration"],
	"section:methods": ["Sign-in methods", "Méthodes de connexion"],
	"section:methods:description": [
		"How your users create an account and sign in.",
		"Comment vos utilisateurs créent un compte et se connectent.",
	],
	"section:providers": ["Sign in with another account", "Connexion avec un autre compte"],
	"section:providers:description": [
		"Let users sign in with an account they already have. Switch a provider on to configure it.",
		"Permettez à vos utilisateurs de se connecter avec un compte qu’ils ont déjà. Activez un fournisseur pour le configurer.",
	],
	"section:mfa": ["Two-step verification", "Double authentification"],
	"section:mfa:description": [
		"Ask for an extra check when users sign in.",
		"Demandez une vérification supplémentaire à la connexion.",
	],
	"section:lockout": ["Account lockout", "Blocage du compte"],
	"section:lockout:description": [
		"Temporarily lock an account after too many failed sign-in attempts.",
		"Bloque temporairement un compte après trop d’échecs de connexion.",
	],
	"section:access": ["Options", "Options"],
	"section:access:description": [
		"What your users approve when an application signs them in.",
		"Ce que vos utilisateurs approuvent quand une application les connecte.",
	],
	"section:profile": ["User profile", "Profil des utilisateurs"],
	"section:profile:description": [
		"Information requested when users sign up.",
		"Informations demandées à l’inscription.",
	],
	"section:branding": ["Branding", "Identité visuelle"],
	"section:branding:description": [
		"Logos, name and links shown on the sign-in page and in emails.",
		"Logos, nom et liens affichés sur la page de connexion et dans les e-mails.",
	],
	"section:languages": ["Languages", "Langues"],
	"section:languages:description": [
		"Languages offered on the sign-in page.",
		"Langues proposées sur la page de connexion.",
	],
	"section:lifetimes": ["Lifetimes", "Durées de validité"],
	"section:lifetimes:description": [
		"How long sessions, tokens and codes stay valid.",
		"Combien de temps restent valides les sessions, jetons et codes.",
	],
	"section:limits": ["Abuse limits", "Limites anti-abus"],
	"section:limits:description": [
		"Maximum number of sends or attempts before a temporary block.",
		"Nombre maximal d’envois ou d’essais avant un blocage temporaire.",
	],
	"section:captcha": ["CAPTCHA", "CAPTCHA"],
	"section:captcha:description": [
		"Ask for a Cloudflare Turnstile check on registration and password sign-in, in the hosted pages and through the SDK.",
		"Demandez une vérification Cloudflare Turnstile à l’inscription et à la connexion par mot de passe, sur les pages hébergées et via le SDK.",
	],
	"captcha:secret": ["Secret key", "Clé secrète"],
	"captcha:secretStored": [
		"The secret key is the TURNSTILE_SECRET_KEY deployment secret. It is never displayed.",
		"La clé secrète est le secret de déploiement TURNSTILE_SECRET_KEY. Elle n’est jamais affichée.",
	],
	"captcha:secretMissing": [
		"The Turnstile secret key is not configured on the server, so CAPTCHA is not enforced until TURNSTILE_SECRET_KEY is added to the deployment.",
		"La clé secrète Turnstile n’est pas configurée sur le serveur : le CAPTCHA ne s’applique pas tant que TURNSTILE_SECRET_KEY n’est pas ajouté au déploiement.",
	],
	"section:selfService": ["Self-service actions", "Actions en libre-service"],
	"section:selfService:description": [
		"What users can do themselves from their account.",
		"Ce que vos utilisateurs peuvent faire eux-mêmes depuis leur compte.",
	],
	"section:logs": ["Logs", "Journaux"],
	"section:logs:description": [
		"History kept and shown in the Activity tab of the users page.",
		"Historique conservé et affiché dans l’onglet Activité de la page Utilisateurs.",
	],
	"section:links": ["Integration links", "Liens d’intégration"],
	"section:links:description": [
		"These addresses are managed by the deployment.",
		"Ces adresses sont gérées par le déploiement.",
	],
	"choice:SUPPORTED_LOCALES:en": ["English", "Anglais"],
	"choice:SUPPORTED_LOCALES:fr": ["French", "Français"],
	"choice:ENFORCE_ONE_MFA_ENROLLMENT:otp": ["Authenticator app", "Application d’authentification"],
	"choice:ENFORCE_ONE_MFA_ENROLLMENT:email": ["Email", "E-mail"],
	"choice:BLOCKED_POLICIES:update_info": ["Update their profile", "Modifier leur profil"],
	"choice:BLOCKED_POLICIES:change_password": ["Change their password", "Changer leur mot de passe"],
	"choice:BLOCKED_POLICIES:change_email": [
		"Change their email address",
		"Changer leur adresse e-mail",
	],
	"choice:BLOCKED_POLICIES:reset_mfa": [
		"Reset their verification methods",
		"Réinitialiser leurs méthodes de vérification",
	],
	"choice:BLOCKED_POLICIES:manage_passkey": ["Manage their passkeys", "Gérer leurs clés d’accès"],
	"choice:BLOCKED_POLICIES:manage_recovery_code": [
		"Manage their recovery codes",
		"Gérer leurs codes de récupération",
	],
	"provider:switch": ["Sign in with {provider}", "Connexion avec {provider}"],
	"provider:oidc": ["Custom OIDC providers", "Fournisseurs OIDC personnalisés"],
	"provider:oidcHelp": [
		"Each provider must also be configured on the server.",
		"Chaque fournisseur doit aussi être configuré sur le serveur.",
	],
	"provider:secretMissing": [
		"The {provider} client secret is not configured on the server, so this sign-in method will not work until it is added to the deployment.",
		"Le secret client {provider} n’est pas configuré sur le serveur : cette méthode de connexion ne fonctionnera pas tant qu’il n’est pas ajouté au déploiement.",
	],
	"status:enabled": ["Enabled", "Activé"],
	"status:off": ["Off", "Désactivé"],
	"status:incomplete": ["To complete", "À compléter"],
	"status:secretMissing": ["Secret missing", "Secret manquant"],
	unit: ["Unit", "Unité"],
	"unit:seconds": ["seconds", "secondes"],
	"unit:minutes": ["minutes", "minutes"],
	"unit:hours": ["hours", "heures"],
	"unit:days": ["days", "jours"],
};
const en = {
	invalidValue: "Check this value.",
	openid: "OpenID configuration",
	jwks: "Public signing keys (JWKS)",
	apiDocs: "API reference",
	title: "Authentication settings",
	description:
		"Manage sign-in and account rules for this instance. Saved changes apply to subsequent authentication requests.",
	saving: "Saving…",
	retry: "Try again",
	saved: "All changes saved.",
	reload: "Reload values",
	loading: "Loading settings…",
	loadFailed: "Settings could not be loaded.",
	saveFailed: "Settings could not be saved. Check the values and try again.",
	conflict: "These settings were changed elsewhere. Reload the values before saving again.",
	listHelp: "Separate values with commas.",
	sections: "Settings sections",
	required: "This value is required.",
	...Object.fromEntries(Object.entries(labels).map(([key, value]) => [key, value[0]])),
	...Object.fromEntries(Object.entries(messages).map(([key, value]) => [key, value[0]])),
};
const fr = {
	...en,
	invalidValue: "Vérifiez cette valeur.",
	openid: "Configuration OpenID",
	jwks: "Clés publiques de signature (JWKS)",
	apiDocs: "Référence API",
	title: "Paramètres d’authentification",
	description:
		"Gérez la connexion et les règles des comptes de cette instance. Les modifications enregistrées s’appliquent aux prochaines requêtes d’authentification.",
	saving: "Enregistrement…",
	retry: "Réessayer",
	saved: "Modifications enregistrées.",
	reload: "Recharger les valeurs",
	loading: "Chargement des paramètres…",
	loadFailed: "Impossible de charger les paramètres.",
	saveFailed: "Impossible d’enregistrer. Vérifiez les valeurs et réessayez.",
	conflict:
		"Ces paramètres ont été modifiés ailleurs. Rechargez les valeurs avant d’enregistrer à nouveau.",
	listHelp: "Séparez les valeurs par des virgules.",
	sections: "Sections des paramètres",
	required: "Cette valeur est obligatoire.",
	...Object.fromEntries(Object.entries(labels).map(([key, value]) => [key, value[1]])),
	...Object.fromEntries(Object.entries(messages).map(([key, value]) => [key, value[1]])),
};
const ar = {
	...en,
	title: "إعدادات المصادقة",
	"tab:sign-in": "تسجيل الدخول",
	"tab:advanced": "متقدم",
	"tab:configuration": "التكوين",
	description:
		"إدارة تسجيل الدخول وقواعد الحسابات. تُطبّق التغييرات المحفوظة على طلبات المصادقة التالية.",
	saving: "جارٍ الحفظ…",
	saved: "تم حفظ الإعدادات.",
	reload: "إعادة تحميل القيم",
	loading: "جارٍ تحميل الإعدادات…",
	sections: "أقسام الإعدادات",
};

export function authenticationSettingsI18n(locale: string) {
	return createFrontI18n({
		locale,
		messages: { [locale]: locale === "fr" ? fr : locale === "ar" ? ar : en },
	});
}
