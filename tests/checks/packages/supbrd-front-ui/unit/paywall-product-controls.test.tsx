import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { PaywallProductControls } from "../../../../../packages/supbrd-front-ui/src/paywall-product-controls.js";

class TestPointerEvent extends MouseEvent {
	pointerId: number;
	pointerType: string;
	isPrimary: boolean;
	constructor(type: string, init: PointerEventInit = {}) {
		super(type, init);
		this.pointerId = init.pointerId ?? 1;
		this.pointerType = init.pointerType ?? "mouse";
		this.isPrimary = init.isPrimary ?? true;
	}
}
beforeAll(() => {
	vi.stubGlobal("PointerEvent", TestPointerEvent);
});
afterAll(() => {
	vi.unstubAllGlobals();
});

const packages = [
	{ id: "monthly", identifier: "monthly", display_name: "Monthly plan" },
	{ id: "yearly", identifier: "yearly", display_name: "Annual plan" },
];
vi.mock(
	"../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({ useProjectSelection: () => ({ selectedProject: { id: "1-test" } }) }),
);
vi.mock("../../../../../packages/supbrd-front-ui/src/shared/lib/api.js", () => ({
	createPluginApiClient: () => ({
		GET: async (path: string) => ({
			data: {
				data: path.endsWith("/offerings")
					? [
							{
								identifier: "default",
								display_name: "Standard",
								package_ids: ["monthly", "yearly"],
							},
							{ identifier: "annual", display_name: "Annual offer", packages: [packages[1]] },
						]
					: packages,
			},
		}),
	}),
}));

function CatalogForm() {
	const [props, setProps] = useState<Record<string, unknown>>({
		offering_identifier: "default",
		package_identifiers: [],
		style: "cards",
	});
	return (
		<PaywallProductControls
			props={props}
			t={(key) => key}
			onChange={(patch) => {
				setProps((value) => ({ ...value, ...patch }));
			}}
		/>
	);
}

it("selects actual catalog packages and resets their selection when the offering changes", async () => {
	const user = userEvent.setup();
	render(<CatalogForm />);
	await screen.findByRole("checkbox", { name: "Monthly plan" });
	await user.click(screen.getByRole("checkbox", { name: "Monthly plan" }));
	expect(screen.getByRole("checkbox", { name: "Monthly plan" })).toBeChecked();
	expect(screen.getByRole("checkbox", { name: "All packages" })).not.toBeChecked();
	await user.click(screen.getByRole("combobox", { name: "Offering identifier" }));
	await user.click(await screen.findByRole("option", { name: "Annual offer" }));
	await waitFor(() => {
		expect(screen.queryByRole("checkbox", { name: "Monthly plan" })).not.toBeInTheDocument();
	});
	expect(screen.getByRole("checkbox", { name: "Annual plan" })).toBeVisible();
	expect(screen.getByRole("checkbox", { name: "All packages" })).toBeChecked();
	await user.click(screen.getByRole("checkbox", { name: "All packages" }));
	expect(screen.getByRole("checkbox", { name: "Annual plan" })).toBeChecked();
	expect(screen.getByRole("checkbox", { name: "All packages" })).not.toBeChecked();
});
