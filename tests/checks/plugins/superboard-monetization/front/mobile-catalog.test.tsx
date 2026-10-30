import { afterEach, beforeEach, expect, test, vi } from "vitest";

import EntitlementsView from "../../../../../packages/plugins/superboard-monetization/src/front/billing/views/superboard.products_entitlements.js";
import ProductsIndexView from "../../../../../packages/plugins/superboard-monetization/src/front/products/views/superboard.products.js";
import OfferingsView from "../../../../../packages/plugins/superboard-monetization/src/front/products/views/superboard.products_offerings.js";
import ProductsView from "../../../../../packages/plugins/superboard-monetization/src/front/products/views/superboard.products_products.js";
import { fireEvent, render, screen } from "../../../packages/supbrd-front-ui/render.js";

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
	"%s opens the purchase catalog directly without a catalog switch",
	async (title, View, action) => {
		render(<View />);
		expect(await screen.findByRole("button", { name: action })).toBeInTheDocument();
		expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
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
