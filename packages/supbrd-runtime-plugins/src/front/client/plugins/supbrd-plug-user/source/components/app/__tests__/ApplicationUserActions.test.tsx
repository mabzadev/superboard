import { expect, it, vi } from "vitest";

import {
	fireEvent,
	render,
	screen,
} from "../../../../../../../../../../supbrd-front-ui/tests/render.js";
import ApplicationUserActions from "../../../../ApplicationUserActions.js";
vi.mock("../../../../transport.js", () => ({
	POST: vi.fn(async () => ({})),
	PUT: vi.fn(async () => ({})),
}));

it("submits the display name with the Save name button", async () => {
	render(
		<ApplicationUserActions
			projectRef="1-prod"
			userId="application-fixture"
			name="Before"
			onChange={async () => undefined}
		/>,
	);
	fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "After" } });
	fireEvent.click(screen.getByRole("button", { name: "Save name" }));
	expect(await screen.findByRole("status")).toHaveTextContent("Application account updated");
});

it("submits a suspension reason with the revoke sessions button", async () => {
	render(
		<ApplicationUserActions
			projectRef="1-prod"
			userId="application-fixture"
			name="Before"
			onChange={async () => undefined}
		/>,
	);
	fireEvent.change(screen.getByLabelText("Suspension reason"), {
		target: { value: "QA suspension" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Suspend account and revoke sessions" }));
	expect(await screen.findByRole("status")).toHaveTextContent(
		"Account suspended; existing sessions revoked",
	);
});
