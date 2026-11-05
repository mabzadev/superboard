import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import EntitlementsView from "../../../../../packages/plugins/superboard-monetization/src/front/billing/views/superboard.products_entitlements.js";
import ProductsIndexView from "../../../../../packages/plugins/superboard-monetization/src/front/products/views/superboard.products.js";
import OfferingsView from "../../../../../packages/plugins/superboard-monetization/src/front/products/views/superboard.products_offerings.js";
import ProductsView from "../../../../../packages/plugins/superboard-monetization/src/front/products/views/superboard.products_products.js";
import {
	FrontContextProvider,
	useOptionalFrontContext,
} from "../../../../../packages/supbrd-front-ui/src/context.js";
import { fireEvent, render, screen, within } from "../../../packages/supbrd-front-ui/render.js";

vi.mock("@superboard/front-ui/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: { id: "9-test" } }),
}));
const api = vi.hoisted(() => ({
	getBillingOverview: vi.fn(),
	createBillingPackage: vi.fn(),
}));

vi.mock(
	"../../../../../packages/plugins/superboard-monetization/src/front/billing/api/billing/billingService.js",
	() => api,
);

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	api.getBillingOverview.mockResolvedValue({
		products: [
			{
				id: "native-product",
				store: "apple",
				store_product_id: "app.pro.monthly",
				product_type: "subscription",
				display_name: "Mobile premium",
				active: 1,
				environment: "sandbox",
			},
		],
		offerings: [
			{
				id: "native-offer",
				identifier: "default",
				display_name: "Mobile offering",
				active: 1,
				is_current: 1,
				placement: "default",
			},
		],
		packages: [],
		entitlements: [],
		product_entitlements: [],
	});
});

test("the Products view displays the same catalog used by mobile purchases", async () => {
	render(<ProductsView />);
	expect(await screen.findByText("app.pro.monthly")).toBeInTheDocument();
	expect(screen.getByText("Mobile premium")).toBeInTheDocument();
});

test.each([
	["Products", ProductsView, "New product"],
	["Products", ProductsIndexView, "New product"],
	["Offerings", OfferingsView, "New offering"],
	["Entitlements", EntitlementsView, "Add entitlement"],
] as const)(
	"%s opens its tab of the purchase catalog without a catalog source switch",
	async (title, View, action) => {
		render(<View />);
		expect(await screen.findByRole("button", { name: action })).toBeInTheDocument();
		expect(screen.getByRole("heading", { level: 1, name: "Catalog" })).toBeInTheDocument();
		const tabs = screen.getByRole("navigation", { name: "Catalog" });
		expect(
			Array.from(tabs.querySelectorAll("a")).map((link) => [
				link.textContent,
				link.getAttribute("href"),
				link.getAttribute("aria-current"),
			]),
		).toEqual(
			["Products", "Offerings", "Entitlements"].map((tab) => [
				tab,
				tab === "Products"
					? "/monetization/products?lang=en"
					: `/monetization/products?tab=${tab.toLowerCase()}&lang=en`,
				tab === title ? "page" : null,
			]),
		);
		expect(screen.queryByRole("group", { name: "Catalog source" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Existing catalog" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Purchases catalog" })).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: action }));
		expect(await screen.findByRole("dialog")).toBeInTheDocument();
	},
);

test("an operator can open package creation from its offering and select a mobile product", async () => {
	render(<OfferingsView />);
	await screen.findByText("Mobile offering");
	fireEvent.click(screen.getByRole("button", { name: "Add package" }));
	expect(await screen.findByRole("dialog")).toBeInTheDocument();
	expect(screen.getByRole("checkbox", { name: /Mobile premium/ })).toBeInTheDocument();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

test("a former Offerings or Entitlements bookmark opens its tab of the Catalog entry", async () => {
	window.history.pushState({}, "", "/monetization/products?tab=entitlements&lang=en");
	try {
		render(<ProductsIndexView />);
		expect(await screen.findByRole("button", { name: "Add entitlement" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Entitlements" })).toHaveAttribute(
			"aria-current",
			"page",
		);
	} finally {
		window.history.pushState({}, "", "/");
	}
});

function French({ children }: { children: ReactNode }) {
	const context = useOptionalFrontContext();
	if (!context) throw new Error("Missing Front context");
	return (
		<FrontContextProvider value={{ ...context, locale: "fr" }}>{children}</FrontContextProvider>
	);
}

const archivedCatalog = {
	products: [
		{
			id: "live-product",
			store: "apple",
			store_product_id: "app.pro.monthly",
			product_type: "subscription",
			display_name: "Mobile premium",
			active: 1,
			environment: "production",
		},
		{
			id: "old-product",
			store: "google",
			store_product_id: "app.pro.legacy",
			product_type: "subscription",
			display_name: "Legacy premium",
			active: 0,
			environment: "sandbox",
		},
	],
	offerings: [
		{
			id: "live-offer",
			identifier: "default",
			display_name: "Mobile offering",
			active: 1,
			is_current: 1,
			placement: "default",
		},
		{
			id: "old-offer",
			identifier: "promo",
			display_name: "Promo offering",
			active: 0,
			is_current: 0,
			placement: "onboarding",
		},
	],
	packages: [],
	entitlements: [
		{ id: "live-access", identifier: "pro", display_name: "Pro access", active: 1 },
		{ id: "old-access", identifier: "legacy", display_name: "Legacy access", active: 0 },
	],
	product_entitlements: [],
};

const card = (text: string) => {
	const element = screen.getByText(text).closest("article");
	if (!element) throw new Error(`Catalog item missing: ${text}`);
	return element;
};

test("each catalog item states whether it is active or archived in the singular, in French", async () => {
	api.getBillingOverview.mockResolvedValue(archivedCatalog);
	const { unmount } = render(<ProductsView />, { wrapper: French });
	await screen.findByText("app.pro.monthly");
	expect(card("app.pro.monthly")).toHaveTextContent("Apple App Store · Production · Actif");
	expect(card("app.pro.legacy")).toHaveTextContent(
		"Facturation Google Play · Bac à sable · Archivé",
	);
	expect(card("app.pro.legacy")).not.toHaveTextContent("Archivés");
	fireEvent.click(
		within(card("app.pro.monthly")).getByRole("button", { name: "Modifier le produit" }),
	);
	const product = await screen.findByRole("dialog");
	expect(within(product).getByRole("heading", { name: "Modifier le produit" })).toBeInTheDocument();
	expect(within(product).getByRole("checkbox", { name: "Actif" })).toBeChecked();
	unmount();

	const offerings = render(<OfferingsView />, { wrapper: French });
	await screen.findByText("promo");
	expect(card("default")).toHaveTextContent("Emplacement : default · Offre courante · Active");
	expect(card("promo")).toHaveTextContent(
		"Emplacement : onboarding · Offre alternative · Archivée",
	);
	fireEvent.click(screen.getByRole("button", { name: "Nouvelle offre" }));
	expect(
		within(await screen.findByRole("dialog")).getByRole("heading", { name: "Nouvelle offre" }),
	).toBeInTheDocument();
	offerings.unmount();

	render(<EntitlementsView />, { wrapper: French });
	await screen.findByText("legacy");
	expect(card("pro")).toHaveTextContent("Actif");
	expect(card("legacy")).toHaveTextContent("Archivé");
	expect(card("legacy")).not.toHaveTextContent("Archivés");
});

test("each catalog item states its state and opens a dialog named after its action, in English", async () => {
	api.getBillingOverview.mockResolvedValue(archivedCatalog);
	render(<ProductsView />);
	await screen.findByText("app.pro.legacy");
	expect(card("app.pro.legacy")).toHaveTextContent("Google Play Billing · Sandbox · Archived");
	fireEvent.click(within(card("app.pro.legacy")).getByRole("button", { name: "Edit product" }));
	const product = await screen.findByRole("dialog");
	expect(within(product).getByRole("heading", { name: "Edit product" })).toBeInTheDocument();
	expect(within(product).getByRole("checkbox", { name: "Active" })).not.toBeChecked();
});
