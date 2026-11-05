import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AuthenticationEditor from "../../../../../packages/plugins/superboard-authentification/src/front/AuthenticationEditor.js";
import {
	FrontContextProvider,
	useOptionalFrontContext,
} from "../../../../../packages/supbrd-front-ui/src/context.js";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../../packages/supbrd-front-ui/render.js";

vi.mock("@superboard/front-ui/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: { id: "1-test" } }),
}));

const billing = vi.hoisted(() => ({
	getOperatorDisplayCurrency: vi.fn(),
	updateOperatorDisplayCurrency: vi.fn(),
}));
vi.mock(
	"../../../../../packages/plugins/superboard-authentification/src/front/api/billing/billingService.js",
	() => billing,
);

const currencies = [
	"USD",
	"EUR",
	"GBP",
	"AUD",
	"CAD",
	"JPY",
	"BRL",
	"KRW",
	"CNY",
	"MXN",
	"SEK",
	"PLN",
];

function Context({
	children,
	locale = "en",
	billingEnabled = true,
}: {
	children: ReactNode;
	locale?: "en" | "fr";
	billingEnabled?: boolean;
}) {
	const context = useOptionalFrontContext();
	if (!context) throw new Error("Missing Front context");
	return (
		<FrontContextProvider
			value={{
				...context,
				locale,
				path: "/auth/settings",
				activePluginIds: billingEnabled
					? context.activePluginIds
					: context.activePluginIds.filter((id) => id !== "superboard-billing"),
			}}
		>
			{children}
		</FrontContextProvider>
	);
}

function openProfile(options: { locale?: "en" | "fr"; billingEnabled?: boolean } = {}) {
	render(<AuthenticationEditor view="settings" />, {
		wrapper: ({ children }) => <Context {...options}>{children}</Context>,
	});
}

describe("operator profile display currency", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.history.replaceState({}, "", "/auth/settings?tab=security&editor=profile");
		billing.getOperatorDisplayCurrency.mockResolvedValue({
			display_currency: "USD",
			available_currencies: currencies,
		});
	});

	it("lets the operator choose their own display currency in their profile", async () => {
		billing.updateOperatorDisplayCurrency.mockResolvedValue({
			display_currency: "EUR",
			available_currencies: currencies,
		});
		openProfile();

		const select = await screen.findByRole("combobox", { name: "Display currency" });
		await waitFor(() => {
			expect(select).toHaveValue("USD");
		});
		expect(screen.getByRole("heading", { name: "Operator profile" })).toBeInTheDocument();
		expect(select).toHaveAccessibleDescription(
			/^Only for you: other operators choose their own\./u,
		);
		expect(
			within(select)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual([
			"US Dollar (USD)",
			"Euro (EUR)",
			"British Pound (GBP)",
			"Australian Dollar (AUD)",
			"Canadian Dollar (CAD)",
			"Japanese Yen (JPY)",
			"Brazilian Real (BRL)",
			"South Korean Won (KRW)",
			"Chinese Yuan (CNY)",
			"Mexican Peso (MXN)",
			"Swedish Krona (SEK)",
			"Polish Zloty (PLN)",
		]);

		fireEvent.change(select, { target: { value: "EUR" } });

		expect(await screen.findByText("Display currency saved.")).toBeInTheDocument();
		expect(billing.updateOperatorDisplayCurrency).toHaveBeenCalledWith("1-test", "EUR");
		expect(select).toHaveValue("EUR");
	});

	it("keeps the previous currency when saving fails, in French", async () => {
		billing.updateOperatorDisplayCurrency.mockRejectedValue(new Error("Forbidden"));
		openProfile({ locale: "fr" });

		const select = await screen.findByRole("combobox", { name: "Devise d’affichage" });
		await waitFor(() => {
			expect(select).toHaveValue("USD");
		});
		expect(screen.getByRole("heading", { name: "Profil opérateur" })).toBeInTheDocument();
		expect(select).toHaveAccessibleDescription(
			/^Pour vous seul : chaque opérateur choisit la sienne\./u,
		);
		expect(within(select).getByRole("option", { name: "Yen japonais (JPY)" })).toBeInTheDocument();

		fireEvent.change(select, { target: { value: "JPY" } });

		expect(
			await screen.findByText("Impossible d’enregistrer la devise d’affichage."),
		).toBeInTheDocument();
		expect(select).toHaveValue("USD");
	});

	it("leaves the currency out of the profile when Monetization is disabled", async () => {
		openProfile({ billingEnabled: false });

		expect(await screen.findByRole("heading", { name: "Operator profile" })).toBeInTheDocument();
		expect(screen.queryByRole("combobox", { name: "Display currency" })).not.toBeInTheDocument();
		expect(billing.getOperatorDisplayCurrency).not.toHaveBeenCalled();
	});
});
