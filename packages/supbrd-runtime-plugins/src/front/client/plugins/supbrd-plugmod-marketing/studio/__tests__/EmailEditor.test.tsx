import {
	createEmailDesign,
	prepareEmailDesign,
	type EmailDesign,
} from "@superboard/contracts/email-studio";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { EmailEditor } from "../EmailEditor.js";

vi.mock("@superboard/front-ui/context", () => ({ useFrontContext: () => ({ locale: "en" }) }));
vi.mock("../service.js", () => ({
	getSharedEmailBlocks: vi.fn().mockResolvedValue([]),
	getEmailVersions: vi.fn().mockResolvedValue([]),
	testStudioEmail: vi.fn(),
	translateStudioEmail: vi.fn(),
	publishStudioTemplate: vi.fn(),
	createSharedEmailBlock: vi.fn(),
	updateSharedEmailBlock: vi.fn(),
	getSharedEmailBlockUsage: vi.fn(),
	applySharedEmailBlock: vi.fn(),
}));

it("autosaves changed copy and displays translations that need review", async () => {
	const initial = createEmailDesign("en");
	initial.locales.en!.status = "approved";
	initial.locales.fr = { ...structuredClone(initial.locales.en!), subject: "Bonjour" };
	const onSave = vi.fn(async (name: string, document: EmailDesign, revision: number) => ({
		id: "message",
		name,
		template_type: "campaign",
		studio_document: prepareEmailDesign(document, initial),
		studio_revision: revision + 1,
	}));
	render(
		<EmailEditor
			project="1-test"
			template={{
				id: "message",
				name: "Welcome",
				template_type: "campaign",
				studio_document: initial,
				studio_revision: 1,
			}}
			onSave={onSave}
			onBack={() => {}}
		/>,
	);
	fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "A new subject" } });
	await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1), { timeout: 4000 });
	fireEvent.click(screen.getByRole("button", { name: "Languages" }));
	expect(await screen.findByText("Needs review")).toBeVisible();
	expect(onSave.mock.calls[0]?.[1].locales.en?.subject).toBe("A new subject");
});
