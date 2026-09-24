export type AuthenticationSettingValue = boolean | number | string | string[];
export type AuthenticationSettings = Record<string, AuthenticationSettingValue>;
export type AuthenticationSettingsGroup =
	| "general"
	| "login"
	| "security"
	| "providers"
	| "advanced";
export interface AuthenticationSettingDefinition {
	type: "boolean" | "number" | "text" | "url" | "list";
	group: AuthenticationSettingsGroup;
	minimum?: number;
	maximum?: number;
	choices?: readonly string[];
}
const flag = (group: AuthenticationSettingsGroup): AuthenticationSettingDefinition => ({
	type: "boolean",
	group,
});
const text = (group: AuthenticationSettingsGroup): AuthenticationSettingDefinition => ({
	type: "text",
	group,
});
const url = (): AuthenticationSettingDefinition => ({ type: "url", group: "general" });
const duration = (maximum = 31_536_000): AuthenticationSettingDefinition => ({
	type: "number",
	group: "advanced",
	minimum: 30,
	maximum,
});
const threshold = (): AuthenticationSettingDefinition => ({
	type: "number",
	group: "security",
	minimum: 1,
	maximum: 1000,
});

export const authenticationSettingDefinitions: Record<string, AuthenticationSettingDefinition> = {
	COMPANY_LOGO_URL: url(),
	COMPANY_EMAIL_LOGO_URL: url(),
	EMAIL_SENDER_NAME: text("general"),
	TERMS_LINK: url(),
	PRIVACY_POLICY_LINK: url(),
	SUPPORTED_LOCALES: { type: "list", group: "general", minimum: 1, choices: ["en", "fr"] },
	ENABLE_LOCALE_SELECTOR: flag("general"),
	ENABLE_NAMES: flag("login"),
	NAMES_IS_REQUIRED: flag("login"),
	ENABLE_SIGN_UP: flag("login"),
	ENABLE_PASSWORD_SIGN_IN: flag("login"),
	ENABLE_PASSWORDLESS_SIGN_IN: flag("login"),
	USE_PASSWORDLESS_AS_MAGIC_LINK: flag("login"),
	ENABLE_EMAIL_VERIFICATION: flag("login"),
	REPLACE_EMAIL_VERIFICATION_WITH_WELCOME_EMAIL: flag("login"),
	ENABLE_PASSWORD_RESET: flag("login"),
	ENABLE_USER_APP_CONSENT: flag("login"),
	ENABLE_APP_BANNER: flag("login"),
	ENABLE_ORG: flag("login"),
	ENABLE_USER_ATTRIBUTE: flag("login"),
	BLOCKED_POLICIES: { type: "list", group: "advanced" },
	AUTHORIZATION_CODE_EXPIRES_IN: duration(3600),
	SPA_ACCESS_TOKEN_EXPIRES_IN: duration(3600),
	SPA_REFRESH_TOKEN_EXPIRES_IN: duration(),
	S2S_ACCESS_TOKEN_EXPIRES_IN: duration(86400),
	ID_TOKEN_EXPIRES_IN: duration(86400),
	SERVER_SESSION_EXPIRES_IN: duration(),
	OTP_MFA_IS_REQUIRED: flag("security"),
	SMS_MFA_IS_REQUIRED: flag("security"),
	EMAIL_MFA_IS_REQUIRED: flag("security"),
	ENFORCE_ONE_MFA_ENROLLMENT: { type: "list", group: "security", choices: ["otp", "sms", "email"] },
	ALLOW_EMAIL_MFA_AS_BACKUP: flag("security"),
	ALLOW_PASSKEY_ENROLLMENT: flag("security"),
	ENABLE_RECOVERY_CODE: flag("security"),
	ENABLE_MFA_REMEMBER_DEVICE: flag("security"),
	ACCOUNT_LOCKOUT_THRESHOLD: threshold(),
	ACCOUNT_LOCKOUT_EXPIRES_IN: {
		type: "number",
		group: "security",
		minimum: 30,
		maximum: 2_592_000,
	},
	UNLOCK_ACCOUNT_VIA_PASSWORD_RESET: flag("security"),
	PASSWORD_RESET_EMAIL_THRESHOLD: threshold(),
	PASSWORD_RESET_CODE_THRESHOLD: threshold(),
	CHANGE_EMAIL_EMAIL_THRESHOLD: threshold(),
	CHANGE_EMAIL_CODE_THRESHOLD: threshold(),
	EMAIL_VERIFICATION_CODE_THRESHOLD: threshold(),
	EMAIL_MFA_EMAIL_THRESHOLD: threshold(),
	SMS_MFA_MESSAGE_THRESHOLD: threshold(),
	MFA_CODE_VERIFY_THRESHOLD: threshold(),
	AUTH_CODE_VERIFIER_THRESHOLD: threshold(),
	GOOGLE_AUTH_CLIENT_ID: text("providers"),
	FACEBOOK_AUTH_CLIENT_ID: text("providers"),
	GITHUB_AUTH_CLIENT_ID: text("providers"),
	GITHUB_AUTH_APP_NAME: text("providers"),
	DISCORD_AUTH_CLIENT_ID: text("providers"),
	APPLE_AUTH_CLIENT_ID: text("providers"),
	OIDC_AUTH_PROVIDERS: { type: "list", group: "providers" },
	ENABLE_EMAIL_LOG: flag("advanced"),
	ENABLE_SMS_LOG: flag("advanced"),
	ENABLE_SIGN_IN_LOG: flag("advanced"),
};
const listItemPattern = /^[a-zA-Z0-9_-]{1,100}$/u;

export class AuthenticationSettingsError extends Error {
	constructor(public readonly field: string) {
		super("AUTHENTICATION_SETTINGS_INVALID");
	}
}

export function validateAuthenticationSettings(value: unknown): AuthenticationSettings {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new AuthenticationSettingsError("values");
	const result: AuthenticationSettings = {};
	for (const [key, setting] of Object.entries(value)) {
		if (!Object.hasOwn(authenticationSettingDefinitions, key))
			throw new AuthenticationSettingsError(key);
		const definition = authenticationSettingDefinitions[key];
		if (!definition) throw new AuthenticationSettingsError(key);
		let valid = false;
		if (definition.type === "boolean") valid = typeof setting === "boolean";
		if (definition.type === "number")
			valid =
				typeof setting === "number" &&
				Number.isSafeInteger(setting) &&
				setting >= (definition.minimum ?? 0) &&
				setting <= (definition.maximum ?? 31_536_000);
		if (definition.type === "text" || definition.type === "url") {
			valid =
				typeof setting === "string" &&
				setting.length <= 2048 &&
				!setting.includes("\r") &&
				!setting.includes("\n") &&
				!setting.includes("\0");
			if (valid && definition.type === "url" && setting !== "") {
				try {
					const parsed = new URL(String(setting));
					valid =
						["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
				} catch {
					valid = false;
				}
			}
		}
		if (definition.type === "list")
			valid =
				Array.isArray(setting) &&
				setting.length >= (definition.minimum ?? 0) &&
				setting.length <= 50 &&
				setting.every(
					(item: unknown) =>
						typeof item === "string" &&
						listItemPattern.test(item) &&
						(!definition.choices || definition.choices.includes(item)),
				);
		if (!valid || !isSettingValue(setting)) throw new AuthenticationSettingsError(key);
		result[key] = setting;
	}
	return result;
}

function isSettingValue(value: unknown): value is AuthenticationSettingValue {
	return (
		typeof value === "boolean" ||
		typeof value === "number" ||
		typeof value === "string" ||
		(Array.isArray(value) && value.every((item: unknown) => typeof item === "string"))
	);
}

export function authenticationSettingsFromEnvironment(environment: object): AuthenticationSettings {
	const values: AuthenticationSettings = {};
	for (const [key, definition] of Object.entries(authenticationSettingDefinitions)) {
		const value: unknown = Reflect.get(environment, key);
		if (definition.type === "boolean") values[key] = value === true;
		else if (definition.type === "number")
			values[key] = typeof value === "number" ? value : (definition.minimum ?? 0);
		else if (definition.type === "list")
			values[key] = Array.isArray(value)
				? value.filter(
						(item: unknown): item is string => typeof item === "string" && item !== "__none__",
					)
				: [];
		else values[key] = typeof value === "string" ? value : "";
	}
	return values;
}

export interface AuthenticationSettingsSnapshot {
	revision: number;
	values: AuthenticationSettings;
	updatedAt: string | null;
	serverUrl?: string;
}
