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
	USE_PASSWORDLESS_AS_MAGIC_LINK: ["Use a magic link", "Utiliser un lien de connexion"],
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
	ENABLE_APP_BANNER: ["Show application banners", "Afficher les bannières des applications"],
	ENABLE_ORG: ["Enable organizations", "Activer les organisations"],
	ENABLE_USER_ATTRIBUTE: [
		"Enable custom user attributes",
		"Activer les attributs utilisateur personnalisés",
	],
	BLOCKED_POLICIES: ["Blocked account actions", "Actions de compte bloquées"],
	AUTHORIZATION_CODE_EXPIRES_IN: [
		"Authorization code lifetime (seconds)",
		"Durée du code d’autorisation (secondes)",
	],
	SPA_ACCESS_TOKEN_EXPIRES_IN: [
		"Application access token lifetime (seconds)",
		"Durée du jeton d’accès applicatif (secondes)",
	],
	SPA_REFRESH_TOKEN_EXPIRES_IN: [
		"Refresh token lifetime (seconds)",
		"Durée du jeton de renouvellement (secondes)",
	],
	S2S_ACCESS_TOKEN_EXPIRES_IN: [
		"Server access token lifetime (seconds)",
		"Durée du jeton serveur (secondes)",
	],
	ID_TOKEN_EXPIRES_IN: [
		"Identity token lifetime (seconds)",
		"Durée du jeton d’identité (secondes)",
	],
	SERVER_SESSION_EXPIRES_IN: ["Session lifetime (seconds)", "Durée de la session (secondes)"],
	OTP_MFA_IS_REQUIRED: [
		"Require an authenticator app",
		"Exiger une application d’authentification",
	],
	SMS_MFA_IS_REQUIRED: ["Require SMS verification", "Exiger la vérification par SMS"],
	EMAIL_MFA_IS_REQUIRED: [
		"Require email verification at sign-in",
		"Exiger un code e-mail à la connexion",
	],
	ENFORCE_ONE_MFA_ENROLLMENT: [
		"Require one of these verification methods",
		"Exiger l’une de ces méthodes de vérification",
	],
	ALLOW_EMAIL_MFA_AS_BACKUP: [
		"Allow email as a backup verification method",
		"Autoriser l’e-mail comme méthode de secours",
	],
	ALLOW_PASSKEY_ENROLLMENT: ["Allow passkeys", "Autoriser les clés d’accès"],
	ENABLE_RECOVERY_CODE: ["Enable recovery codes", "Activer les codes de récupération"],
	ENABLE_MFA_REMEMBER_DEVICE: ["Allow trusted devices", "Mémoriser les appareils de confiance"],
	ACCOUNT_LOCKOUT_THRESHOLD: [
		"Failed attempts before account lockout",
		"Échecs avant blocage du compte",
	],
	ACCOUNT_LOCKOUT_EXPIRES_IN: [
		"Account lockout duration (seconds)",
		"Durée du blocage du compte (secondes)",
	],
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
	SMS_MFA_MESSAGE_THRESHOLD: ["SMS verification message limit", "Limite de SMS de vérification"],
	MFA_CODE_VERIFY_THRESHOLD: [
		"Verification code attempt limit",
		"Limite d’essais des codes de vérification",
	],
	AUTH_CODE_VERIFIER_THRESHOLD: [
		"Authorization code attempt limit",
		"Limite d’essais du code d’autorisation",
	],
	GOOGLE_AUTH_CLIENT_ID: ["Google client ID", "Identifiant client Google"],
	FACEBOOK_AUTH_CLIENT_ID: ["Facebook client ID", "Identifiant client Facebook"],
	GITHUB_AUTH_CLIENT_ID: ["GitHub client ID", "Identifiant client GitHub"],
	GITHUB_AUTH_APP_NAME: ["GitHub application name", "Nom de l’application GitHub"],
	DISCORD_AUTH_CLIENT_ID: ["Discord client ID", "Identifiant client Discord"],
	APPLE_AUTH_CLIENT_ID: ["Apple client ID", "Identifiant client Apple"],
	OIDC_AUTH_PROVIDERS: ["Additional OIDC providers", "Fournisseurs OIDC supplémentaires"],
	ENABLE_EMAIL_LOG: ["Keep email logs", "Journaliser les e-mails"],
	ENABLE_SMS_LOG: ["Keep SMS logs", "Journaliser les SMS"],
	ENABLE_SIGN_IN_LOG: ["Keep sign-in logs", "Journaliser les connexions"],
};
const en = {
	invalidValue: "Check this value.",
	integrationLinks: "Integration links",
	managedAddresses: "These addresses are managed by the deployment.",
	openid: "OpenID configuration",
	jwks: "Public signing keys (JWKS)",
	apiDocs: "API reference",
	title: "Authentication settings",
	description:
		"Manage sign-in and account rules for this instance. Saved changes apply to subsequent authentication requests.",
	general: "General",
	login: "Sign-in",
	security: "Security",
	providers: "Providers",
	advanced: "Advanced",
	configuration: "Configuration",
	save: "Save changes",
	saving: "Saving…",
	saved: "Settings saved.",
	cancel: "Cancel changes",
	reload: "Reload values",
	loading: "Loading settings…",
	loadFailed: "Settings could not be loaded.",
	saveFailed: "Settings could not be saved. Check the values and try again.",
	conflict: "These settings were changed elsewhere. Reload the values before saving again.",
	providerHelp:
		"Client secrets remain managed by the deployment. Adding a client ID does not configure its secret.",
	listHelp: "Separate values with commas.",
	choices: "Available values",
	sections: "Settings sections",
	required: "This value is required.",
	...Object.fromEntries(Object.entries(labels).map(([key, value]) => [key, value[0]])),
};
const fr = {
	...en,
	invalidValue: "Vérifiez cette valeur.",
	integrationLinks: "Liens d’intégration",
	managedAddresses: "Ces adresses sont gérées par le déploiement.",
	openid: "Configuration OpenID",
	jwks: "Clés publiques de signature (JWKS)",
	apiDocs: "Référence API",
	title: "Paramètres d’authentification",
	description:
		"Gérez la connexion et les règles des comptes de cette instance. Les modifications enregistrées s’appliquent aux prochaines requêtes d’authentification.",
	general: "Général",
	login: "Connexion",
	security: "Sécurité",
	providers: "Fournisseurs",
	advanced: "Avancé",
	configuration: "Configuration",
	save: "Enregistrer",
	saving: "Enregistrement…",
	saved: "Paramètres enregistrés.",
	cancel: "Annuler les modifications",
	reload: "Recharger les valeurs",
	loading: "Chargement des paramètres…",
	loadFailed: "Impossible de charger les paramètres.",
	saveFailed: "Impossible d’enregistrer. Vérifiez les valeurs et réessayez.",
	conflict:
		"Ces paramètres ont été modifiés ailleurs. Rechargez les valeurs avant d’enregistrer à nouveau.",
	providerHelp:
		"Les secrets clients restent gérés dans le déploiement. Ajouter un identifiant client ne configure pas son secret.",
	listHelp: "Séparez les valeurs par des virgules.",
	choices: "Valeurs possibles",
	sections: "Sections des paramètres",
	required: "Cette valeur est obligatoire.",
	...Object.fromEntries(Object.entries(labels).map(([key, value]) => [key, value[1]])),
};
const ar = {
	...en,
	title: "إعدادات المصادقة",
	description:
		"إدارة تسجيل الدخول وقواعد الحسابات. تُطبّق التغييرات المحفوظة على طلبات المصادقة التالية.",
	general: "عام",
	login: "تسجيل الدخول",
	security: "الأمان",
	providers: "المزوّدون",
	advanced: "متقدم",
	configuration: "التكوين",
	save: "حفظ التغييرات",
	saving: "جارٍ الحفظ…",
	saved: "تم حفظ الإعدادات.",
	cancel: "إلغاء التغييرات",
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
