import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ExperienceEditor } from "../../../../../../supbrd-runtime-plugins/src/front/client/plugins/supbrd-plugmod-onboardings/source/components/experience-editor/ExperienceEditor.js";
import { createExperienceDocument } from "../../../../../../supbrd-runtime-plugins/src/front/client/plugins/supbrd-plugmod-onboardings/source/components/experience-editor/model.js";
import type { ReactNode } from "react";
import { ProjectSelectionProvider } from "../../../context/useProjectSelection.js";
import { fireEvent, render as renderWithContext, screen } from "../../../../../tests/render.js";

const render = (ui: ReactNode) => renderWithContext(ui, { wrapper: ProjectSelectionProvider });

describe("ExperienceEditor", () => {
	it("adds screens and supports undo/redo", async () => {
		const user = userEvent.setup();
		render(<ExperienceEditor kind="onboarding" initialDocument={createExperienceDocument()} />);
		await user.click(screen.getByRole("button", { name: /add/i }));
		expect(screen.getByRole("button", { name: /2\. welcome/i })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /undo/i }));
		expect(screen.queryByRole("button", { name: /2\. welcome/i })).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: /redo/i }));
		expect(screen.getByRole("button", { name: /2\. welcome/i })).toBeInTheDocument();
	});

	it("edits content, validates it and emits the latest document", async () => {
		const onChange = vi.fn();
		const user = userEvent.setup();
		render(
			<ExperienceEditor
				kind="paywall"
				initialDocument={createExperienceDocument()}
				onChange={onChange}
			/>,
		);
		await user.click(screen.getByText("Unlock everything"));
		const editor = screen.getByRole("textbox", { name: "Text" });
		fireEvent.change(editor, { target: { value: "" } });
		expect(await screen.findByText("Text cannot be empty.")).toBeInTheDocument();
		expect(onChange).toHaveBeenLastCalledWith(expect.any(Object), false);
		fireEvent.change(editor, { target: { value: "Premium for everyone" } });
		expect(onChange).toHaveBeenLastCalledWith(
			expect.objectContaining({ screens: expect.any(Array) }),
			true,
		);
	});

	it("renders the mobile preview with the configured theme", async () => {
		const user = userEvent.setup();
		const document = createExperienceDocument();
		document.theme.accent_color = "#ff0066";
		render(<ExperienceEditor kind="onboarding" initialDocument={document} />);
		await user.click(screen.getByRole("button", { name: /preview/i }));
		expect(screen.getByText("Unlock everything")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Continue" })).toHaveStyle({
			background: "#ff0066",
		});
	});

	it("configures onboarding screen conditions", async () => {
		const onChange = vi.fn();
		const user = userEvent.setup();
		render(
			<ExperienceEditor
				kind="onboarding"
				initialDocument={createExperienceDocument()}
				onChange={onChange}
			/>,
		);
		await user.click(screen.getByText("Screen settings"));
		await user.type(screen.getByLabelText("Platform"), "ios");
		await user.type(screen.getByLabelText("Locale"), "fr-FR");
		expect(onChange).toHaveBeenLastCalledWith(
			expect.objectContaining({
				screens: [
					expect.objectContaining({
						conditions: { platform: "ios", locale: "fr-FR" },
					}),
				],
			}),
			true,
		);
	});

	it("configures the Products offering contract on paywalls", async () => {
		const onChange = vi.fn();
		const user = userEvent.setup();
		render(
			<ExperienceEditor
				kind="paywall"
				initialDocument={createExperienceDocument()}
				onChange={onChange}
			/>,
		);
		await user.click(screen.getByRole("button", { name: "Product" }));
		const offering = screen.getByLabelText("Offering identifier");
		await user.clear(offering);
		await user.type(offering, "premium");
		await user.type(screen.getByLabelText("Package identifiers"), "monthly,annual");
		expect(onChange).toHaveBeenLastCalledWith(
			expect.objectContaining({ screens: expect.any(Array) }),
			true,
		);
	});
});
