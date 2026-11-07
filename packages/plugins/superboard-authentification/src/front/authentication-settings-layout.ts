import type {
	AuthenticationProviderWithSecret,
	AuthenticationSettings,
} from "@superboard/contracts/authentication-settings";

export const settingsTabs = ["sign-in", "access", "fields", "appearance", "advanced"] as const;
export type SettingsTab = (typeof settingsTabs)[number];

type Condition = (values: AuthenticationSettings) => boolean;

export type SettingItem =
	| { kind: "switch"; key: string; children?: SettingItem[]; when?: Condition }
	| { kind: "field"; key: string }
	| { kind: "duration"; key: string }
	| { kind: "choices"; key: string; choices: readonly string[]; inverted?: boolean }
	| { kind: "providers" }
	| { kind: "links" };

export interface SettingsSection {
	id: string;
	items: SettingItem[];
}

export interface SignInProvider {
	id: string;
	name: string;
	keys: readonly string[];
	secret?: AuthenticationProviderWithSecret;
}

export const signInProviders: readonly SignInProvider[] = [
	{ id: "google", name: "Google", keys: ["GOOGLE_AUTH_CLIENT_ID"] },
	{
		id: "github",
		name: "GitHub",
		keys: ["GITHUB_AUTH_CLIENT_ID", "GITHUB_AUTH_APP_NAME"],
		secret: "github",
	},
	{ id: "apple", name: "Apple", keys: ["APPLE_AUTH_CLIENT_ID"], secret: "apple" },
	{ id: "oidc", name: "OIDC", keys: ["OIDC_AUTH_PROVIDERS"] },
];

const on =
	(...keys: string[]): Condition =>
	(values) =>
		keys.every((key) => values[key] === true);
const toggle = (key: string, children?: SettingItem[], when?: Condition): SettingItem => ({
	kind: "switch",
	key,
	...(children ? { children } : {}),
	...(when ? { when } : {}),
});
const field = (key: string): SettingItem => ({ kind: "field", key });
const duration = (key: string): SettingItem => ({ kind: "duration", key });

export const settingsLayout: Record<SettingsTab, SettingsSection[]> = {
	"sign-in": [
		{
			id: "methods",
			items: [
				toggle("ENABLE_SIGN_UP"),
				toggle("ENABLE_PASSWORD_SIGN_IN", [toggle("ENABLE_PASSWORD_RESET")]),
				toggle("ENABLE_PASSWORDLESS_SIGN_IN", [toggle("USE_PASSWORDLESS_AS_MAGIC_LINK")]),
				toggle("ENABLE_EMAIL_VERIFICATION", [
					toggle("REPLACE_EMAIL_VERIFICATION_WITH_WELCOME_EMAIL"),
				]),
				toggle("ALLOW_PASSKEY_ENROLLMENT"),
			],
		},
		{ id: "providers", items: [{ kind: "providers" }] },
		{
			id: "mfa",
			items: [
				toggle("OTP_MFA_IS_REQUIRED"),
				toggle("EMAIL_MFA_IS_REQUIRED"),
				{ kind: "choices", key: "ENFORCE_ONE_MFA_ENROLLMENT", choices: ["otp", "email"] },
				toggle("ALLOW_EMAIL_MFA_AS_BACKUP"),
				toggle("ENABLE_MFA_REMEMBER_DEVICE"),
				toggle("ENABLE_RECOVERY_CODE"),
			],
		},
		{
			id: "lockout",
			items: [
				field("ACCOUNT_LOCKOUT_THRESHOLD"),
				duration("ACCOUNT_LOCKOUT_EXPIRES_IN"),
				toggle(
					"UNLOCK_ACCOUNT_VIA_PASSWORD_RESET",
					undefined,
					on("ENABLE_PASSWORD_SIGN_IN", "ENABLE_PASSWORD_RESET"),
				),
			],
		},
	],
	access: [{ id: "access", items: [toggle("ENABLE_USER_APP_CONSENT")] }],
	fields: [
		{
			id: "profile",
			items: [toggle("ENABLE_NAMES", [toggle("NAMES_IS_REQUIRED")]), toggle("ENABLE_USER_ATTRIBUTE")],
		},
	],
	appearance: [
		{
			id: "branding",
			items: [
				field("COMPANY_LOGO_URL"),
				field("COMPANY_EMAIL_LOGO_URL"),
				field("EMAIL_SENDER_NAME"),
				field("TERMS_LINK"),
				field("PRIVACY_POLICY_LINK"),
			],
		},
		{
			id: "languages",
			items: [
				{ kind: "choices", key: "SUPPORTED_LOCALES", choices: ["en", "fr"] },
				toggle(
					"ENABLE_LOCALE_SELECTOR",
					undefined,
					(values) => Array.isArray(values.SUPPORTED_LOCALES) && values.SUPPORTED_LOCALES.length > 1,
				),
			],
		},
	],
	advanced: [
		{
			id: "lifetimes",
			items: [
				duration("SERVER_SESSION_EXPIRES_IN"),
				duration("SPA_ACCESS_TOKEN_EXPIRES_IN"),
				duration("SPA_REFRESH_TOKEN_EXPIRES_IN"),
				duration("ID_TOKEN_EXPIRES_IN"),
				duration("S2S_ACCESS_TOKEN_EXPIRES_IN"),
				duration("AUTHORIZATION_CODE_EXPIRES_IN"),
			],
		},
		{
			id: "limits",
			items: [
				field("PASSWORD_RESET_EMAIL_THRESHOLD"),
				field("PASSWORD_RESET_CODE_THRESHOLD"),
				field("CHANGE_EMAIL_EMAIL_THRESHOLD"),
				field("CHANGE_EMAIL_CODE_THRESHOLD"),
				field("EMAIL_VERIFICATION_CODE_THRESHOLD"),
				field("EMAIL_MFA_EMAIL_THRESHOLD"),
				field("MFA_CODE_VERIFY_THRESHOLD"),
				field("AUTH_CODE_VERIFIER_THRESHOLD"),
			],
		},
		{
			id: "selfService",
			items: [
				{
					kind: "choices",
					key: "BLOCKED_POLICIES",
					inverted: true,
					choices: [
						"update_info",
						"change_password",
						"change_email",
						"reset_mfa",
						"manage_passkey",
						"manage_recovery_code",
					],
				},
			],
		},
		{
			id: "logs",
			items: [toggle("ENABLE_EMAIL_LOG"), toggle("ENABLE_SIGN_IN_LOG")],
		},
		{ id: "links", items: [{ kind: "links" }] },
	],
};

function itemKeys(item: SettingItem): string[] {
	if (item.kind === "providers") return signInProviders.flatMap((provider) => provider.keys);
	if (item.kind === "links") return [];
	return [item.key, ...(item.kind === "switch" ? (item.children ?? []).flatMap(itemKeys) : [])];
}

const tabByKey = new Map(
	settingsTabs.flatMap((tab) =>
		settingsLayout[tab].flatMap((section) =>
			section.items.flatMap(itemKeys).map((key) => [key, tab] as const),
		),
	),
);

export function settingTab(key: string): SettingsTab | undefined {
	return tabByKey.get(key);
}
