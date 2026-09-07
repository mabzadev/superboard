import { FrontContextProvider, type FrontContextValue } from "@superboard/front-ui/context";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

import { ProjectSelectionProvider } from "../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js";
import { PurchasesPage } from "../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plugmod-billing/source/components/modules/ProductsPages.js";

const network = vi.hoisted(() => ({ complete: false, progress: 0, unavailable: false }));
vi.mock("../../../packages/supbrd-front-ui/src/shared/lib/api.js", () => ({
	createPluginApiClient: () => ({
		GET: async (path: string) => {
			let data: unknown = [];
			if (path.endsWith("migration/status"))
				data = { complete: network.complete, table: "products", cursor: [] };
			if (path.includes("/statistics"))
				data = { totals: {}, products: [], platforms: [], series: [] };
			if (path.includes("/purchases") && network.complete)
				data = [
					{
						id: "historic-purchase",
						product_name: "Historical lifetime purchase",
						purchased_at: "2024-01-01",
						purchased_price_micros: 4990000,
						currency: "EUR",
						status: "active",
						environment: "production",
						store: "manual",
						external_transaction_id: "historic-transaction",
						external_customer_id: "legacy-customer",
						product_id: "legacy-product",
					},
				];
			return { data: { data } };
		},
		POST: async () => {
			if (network.unavailable) throw new Error("Products unavailable");
			network.progress++;
			network.complete = network.progress >= 2;
			return { data: { data: { complete: network.complete, table: "purchases" } } };
		},
	}),
}));
const project = {
	id: "42-prod",
	internal_id: "81",
	name: "Production",
	identifier: "production",
	is_test: false,
	created_at: "2026-01-01",
	updated_at: "2026-01-01",
};
const context: FrontContextValue = {
	instanceId: "42",
	pluginId: "supbrd-plugmod-billing",
	path: "/products/purchases",
	parameters: {},
	locale: "fr",
	operator: { id: "operator", email: "operator@example.test", name: null, role: 50 },
	activePluginIds: ["supbrd-plugmod-billing", "supbrd-plug-products"],
	projectScope: {
		production_project_ref: project.id,
		test_project_ref: "42-test",
		instance: {
			id: "42",
			name: "Billing",
			uri_scheme: "billing",
			get_started_dismissed: false,
			created_at: "2026-01-01",
			updated_at: "2026-01-01",
			production: project,
			test: { ...project, id: "42-test", is_test: true },
			projects: [project],
		},
	},
};
test("the purchase page resumes an interrupted historical import and shows its persisted purchases", async () => {
	Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
		configurable: true,
		value: true,
	});
	network.complete = false;
	network.progress = 0;
	network.unavailable = false;
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const button = (label: string) =>
		[...container.querySelectorAll("button")].find((element) =>
			element.textContent?.includes(label),
		);
	try {
		await act(async () =>
			root.render(
				<FrontContextProvider value={context}>
					<ProjectSelectionProvider>
						<PurchasesPage />
					</ProjectSelectionProvider>
				</FrontContextProvider>,
			),
		);
		expect(button("Importer les achats historiques")).toBeDefined();
		await act(async () => button("Importer les achats historiques")!.click());
		expect(button("Continuer l’import")).toBeDefined();
		network.unavailable = true;
		await act(async () => button("Continuer l’import")!.click());
		expect(container.textContent).toContain("Products unavailable");
		network.unavailable = false;
		await act(async () => button("Continuer l’import")!.click());
		expect(container.textContent).toContain("Historical lifetime purchase");
		expect(button("Continuer l’import")).toBeUndefined();
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
});
