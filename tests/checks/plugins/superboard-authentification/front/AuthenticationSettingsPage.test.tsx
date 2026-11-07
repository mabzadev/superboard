import {
	authenticationSettingDefinitions,
	authenticationSettingsFromEnvironment,
	type AuthenticationSettingsSnapshot,
} from "@superboard/contracts/authentication-settings";
import { FrontContextProvider, useFrontContext } from "@superboard/front-ui/context";
import { QueryClient, QueryClientProvider } from "@superboard/front-ui/query";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";

import { fireEvent, render, screen, within } from "../../../packages/supbrd-front-ui/render.js";

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock(
	"../../../../../packages/plugins/superboard-authentification/src/front/transport.js",
	() => ({ GET: api.get, PUT: api.put }),
);
vi.mock(
	"../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({ useProjectSelection: () => ({ selectedProject: { id: "1-test" } }) }),
);

import { settingTab } from "../../../../../packages/plugins/superboard-authentification/src/front/authentication-settings-layout.js";
import AuthenticationSettingsPage from "../../../../../packages/plugins/superboard-authentification/src/front/AuthenticationSettingsPage.js";

let stored: AuthenticationSettingsSnapshot;
beforeAll(() => {
	if (!("PointerEvent" in window))
		Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });
});
beforeEach(() => {
	stored = {
		revision: 0,
		updatedAt: null,
		deployment: {
			providerSecrets: { github: true, apple: false },
		},
		values: authenticationSettingsFromEnvironment({
			SUPPORTED_LOCALES: ["en", "fr"],
			ENABLE_PASSWORD_SIGN_IN: true,
			ENABLE_PASSWORDLESS_SIGN_IN: false,
			USE_PASSWORDLESS_AS_MAGIC_LINK: true,
			SERVER_SESSION_EXPIRES_IN: 1800,
		}),
	};
	api.get.mockReset().mockImplementation(async () => ({ data: structuredClone(stored) }));
	api.put
		.mockReset()
		.mockImplementation(
			async (_path: string, body: { revision: number; values: Record<string, unknown> }) => {
				stored = {
					...stored,
					revision: body.revision + 1,
					values: {
						...stored.values,
						...(body.values as AuthenticationSettingsSnapshot["values"]),
					},
				};
				return { data: structuredClone(stored) };
			},
		);
});

function French({ children }: { children: ReactNode }) {
	return (
		<FrontContextProvider value={{ ...useFrontContext(), locale: "fr" }}>
			{children}
		</FrontContextProvider>
	);
}

function renderTab(tab: "sign-in" | "appearance" | "advanced", locale: "en" | "fr" = "en") {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const page = <AuthenticationSettingsPage tab={tab} />;
	render(
		<QueryClientProvider client={client}>
			{locale === "fr" ? <French>{page}</French> : page}
		</QueryClientProvider>,
	);
}

async function captchaRow(name = "CAPTCHA (Turnstile)") {
	const captcha = await screen.findByRole("switch", { name });
	const row = captcha.closest("[data-setting='captcha']");
	if (!(row instanceof HTMLElement)) throw new Error("The CAPTCHA setting row is missing");
	return { captcha, row: within(row) };
}

test("a sign-in provider shows its fields only once it is switched on", async () => {
	renderTab("sign-in");
	const google = await screen.findByRole("switch", { name: "Sign in with Google" });
	expect(google).not.toBeChecked();
	expect(screen.queryByLabelText("Google client ID")).toBeNull();
	fireEvent.click(google);
	fireEvent.change(screen.getByLabelText("Google client ID"), { target: { value: "google-id" } });
	await vi.waitFor(() => expect(stored.values.GOOGLE_AUTH_CLIENT_ID).toBe("google-id"), {
		timeout: 3000,
	});
});

test("switching a provider off removes its client ID", async () => {
	stored.values.GOOGLE_AUTH_CLIENT_ID = "google-id";
	renderTab("sign-in");
	const google = await screen.findByRole("switch", { name: "Sign in with Google" });
	expect(google).toBeChecked();
	fireEvent.click(google);
	expect(screen.queryByLabelText("Google client ID")).toBeNull();
	await vi.waitFor(() => expect(stored.values.GOOGLE_AUTH_CLIENT_ID).toBe(""), { timeout: 3000 });
});

test("an enabled provider whose secret is missing from the deployment is flagged", async () => {
	stored.values.APPLE_AUTH_CLIENT_ID = "apple-id";
	stored.values.GITHUB_AUTH_CLIENT_ID = "github-id";
	renderTab("sign-in");
	expect(await screen.findByText(/Apple client secret is not configured/)).toBeInTheDocument();
	expect(screen.queryByText(/GitHub client secret is not configured/)).toBeNull();
});

test("an option that depends on a disabled setting stays hidden until it is enabled", async () => {
	renderTab("sign-in");
	const passwordless = await screen.findByRole("switch", { name: "Allow passwordless sign-in" });
	expect(
		screen.queryByRole("switch", { name: "Send a sign-in link instead of a code" }),
	).toBeNull();
	fireEvent.click(passwordless);
	expect(
		screen.getByRole("switch", { name: "Send a sign-in link instead of a code" }),
	).toBeChecked();
});

test("technical settings are only on the advanced tab, with durations in readable units", async () => {
	renderTab("sign-in");
	await screen.findByRole("switch", { name: "Allow registration" });
	expect(screen.queryByLabelText("Session lifetime")).toBeNull();
	expect(screen.queryByLabelText("Password reset email limit")).toBeNull();
});

test("a duration is edited in its unit and saved in seconds", async () => {
	renderTab("advanced");
	const session = await screen.findByLabelText("Session lifetime");
	expect(session).toHaveValue("30");
	fireEvent.change(session, { target: { value: "45" } });
	await vi.waitFor(() => expect(stored.values.SERVER_SESSION_EXPIRES_IN).toBe(2700), {
		timeout: 3000,
	});
});

test("languages are switches and the last remaining one cannot be turned off", async () => {
	renderTab("appearance");
	const french = await screen.findByRole("switch", { name: "French" });
	fireEvent.click(french);
	expect(screen.getByRole("switch", { name: "English" })).toBeDisabled();
	await vi.waitFor(() => expect(stored.values.SUPPORTED_LOCALES).toEqual(["en"]), {
		timeout: 3000,
	});
});

test("self-service actions are allowed by default and turning one off blocks it", async () => {
	renderTab("advanced");
	const changeEmail = await screen.findByRole("switch", { name: "Change their email address" });
	expect(changeEmail).toBeChecked();
	fireEvent.click(changeEmail);
	await vi.waitFor(() => expect(stored.values.BLOCKED_POLICIES).toEqual(["change_email"]), {
		timeout: 3000,
	});
});

test("an edit made while an automatic save is in flight is saved too", async () => {
	const firstSave = Promise.withResolvers<void>();
	const save = api.put.getMockImplementation();
	api.put.mockImplementationOnce(async (...args: unknown[]) => {
		await firstSave.promise;
		return save?.(...args);
	});
	renderTab("sign-in");
	fireEvent.click(await screen.findByRole("switch", { name: "Allow passkeys" }));
	await vi.waitFor(() => expect(api.put).toHaveBeenCalledTimes(1), { timeout: 3000 });
	fireEvent.click(screen.getByRole("switch", { name: "Allow registration" }));
	firstSave.resolve();
	await vi.waitFor(
		() => {
			expect(stored.values.ALLOW_PASSKEY_ENROLLMENT).toBe(true);
			expect(stored.values.ENABLE_SIGN_UP).toBe(true);
		},
		{ timeout: 3000 },
	);
});

test("settings saved before banners, Facebook, Discord, SMS and organizations were removed still load", async () => {
	stored.values = {
		...stored.values,
		ENABLE_APP_BANNER: true,
		FACEBOOK_AUTH_CLIENT_ID: "facebook-id",
		SMS_MFA_IS_REQUIRED: true,
		ENABLE_ORG: true,
		ENFORCE_ONE_MFA_ENROLLMENT: ["sms", "otp"],
	};
	renderTab("sign-in");
	expect(await screen.findByRole("switch", { name: "Authenticator app" })).toBeChecked();
	expect(screen.queryByRole("alert")).toBeNull();
});

test("every authentication setting is reachable from one settings tab", () => {
	const unreachable = Object.keys(authenticationSettingDefinitions).filter(
		(key) => settingTab(key) === undefined,
	);
	expect(unreachable).toEqual([]);
});

test("the CAPTCHA site key stays hidden until CAPTCHA is switched on, then saves with it", async () => {
	stored.deployment = { providerSecrets: { github: true, apple: false }, captchaSecret: true };
	renderTab("advanced");
	const { captcha, row } = await captchaRow();
	expect(captcha).not.toBeChecked();
	expect(row.getByText("Off")).toBeInTheDocument();
	expect(row.queryByLabelText("Site key")).toBeNull();
	fireEvent.click(captcha);
	expect(row.getByText("To complete")).toBeInTheDocument();
	fireEvent.change(row.getByLabelText("Site key"), {
		target: { value: "1x00000000000000000000AA" },
	});
	expect(row.getByText("Enabled")).toBeInTheDocument();
	await vi.waitFor(
		() =>
			expect(api.put).toHaveBeenLastCalledWith(expect.any(String), {
				revision: 0,
				values: { ENABLE_CAPTCHA: true, TURNSTILE_SITE_KEY: "1x00000000000000000000AA" },
			}),
		{ timeout: 3000 },
	);
	expect(screen.getByRole("status")).toHaveTextContent("All changes saved.");
});

test("CAPTCHA is flagged when the deployment lacks the Turnstile secret key", async () => {
	stored.values.ENABLE_CAPTCHA = true;
	stored.values.TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
	renderTab("advanced");
	const { row } = await captchaRow();
	expect(row.getByText("Secret missing")).toBeInTheDocument();
	expect(row.getByText(/TURNSTILE_SECRET_KEY/u)).toBeInTheDocument();
	expect(row.getByLabelText("Site key")).toHaveValue("1x00000000000000000000AA");
	expect(row.queryByDisplayValue(/secret/iu)).toBeNull();
});

test("switching CAPTCHA off hides its fields and keeps the site key for later", async () => {
	stored.deployment = { providerSecrets: { github: true, apple: false }, captchaSecret: true };
	stored.values.ENABLE_CAPTCHA = true;
	stored.values.TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
	renderTab("advanced");
	const { captcha, row } = await captchaRow();
	expect(row.getByText("Enabled")).toBeInTheDocument();
	fireEvent.click(captcha);
	expect(row.queryByLabelText("Site key")).toBeNull();
	await vi.waitFor(() => expect(stored.values.ENABLE_CAPTCHA).toBe(false), { timeout: 3000 });
	expect(stored.values.TURNSTILE_SITE_KEY).toBe("1x00000000000000000000AA");
});

test("the CAPTCHA settings are shown in French", async () => {
	renderTab("advanced", "fr");
	const { captcha, row } = await captchaRow("CAPTCHA (Turnstile)");
	expect(row.getByText("Désactivé")).toBeInTheDocument();
	fireEvent.click(captcha);
	fireEvent.change(row.getByLabelText("Clé de site"), {
		target: { value: "1x00000000000000000000AA" },
	});
	expect(row.getByText("Secret manquant")).toBeInTheDocument();
});
