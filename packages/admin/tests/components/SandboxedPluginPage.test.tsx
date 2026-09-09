import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { SandboxedPluginPage } from "../../src/components/SandboxedPluginPage.js";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function blocks(text: string) {
	return Response.json({ data: { blocks: [{ type: "section", text }] } });
}

test("reloads server-generated plugin content when the native admin language changes", async () => {
	const i18n = setupI18n({ locale: "en", messages: { en: {}, fr: {}, ar: {} } });
	vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
		const locale = new Headers(init?.headers).get("Accept-Language");
		return blocks(locale === "fr" ? "Paramètres" : locale === "ar" ? "الإعدادات" : "Settings");
	});
	render(
		<I18nProvider i18n={i18n}>
			<SandboxedPluginPage pluginId="plugin-a" page="/" />
		</I18nProvider>,
	);
	expect(await screen.findByText("Settings")).toBeInTheDocument();
	await act(async () => {
		i18n.activate("fr");
	});
	expect(await screen.findByText("Paramètres")).toBeInTheDocument();
	expect(screen.queryByText("Settings")).toBeNull();
	await act(async () => {
		i18n.activate("ar");
	});
	expect(await screen.findByText("الإعدادات")).toBeInTheDocument();
	expect(screen.queryByText("Paramètres")).toBeNull();
});

test("ignores an older page response that arrives after switching the admin language", async () => {
	const i18n = setupI18n({ locale: "en", messages: { en: {}, fr: {} } });
	let finishEnglish: ((response: Response) => void) | undefined;
	vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
		if (new Headers(init?.headers).get("Accept-Language") === "fr") return blocks("Paramètres");
		return new Promise<Response>((resolve) => {
			finishEnglish = resolve;
		});
	});
	render(
		<I18nProvider i18n={i18n}>
			<SandboxedPluginPage pluginId="plugin-a" page="/" />
		</I18nProvider>,
	);
	await waitFor(() => expect(finishEnglish).toBeDefined());
	await act(async () => {
		i18n.activate("fr");
	});
	expect(await screen.findByText("Paramètres")).toBeInTheDocument();
	await act(async () => {
		finishEnglish!(blocks("Settings"));
	});
	expect(screen.queryByText("Settings")).toBeNull();
	expect(screen.getByText("Paramètres")).toBeInTheDocument();
});
