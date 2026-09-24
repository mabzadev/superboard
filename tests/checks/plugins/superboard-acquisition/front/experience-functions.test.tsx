import { expect, test, vi } from "vitest";

import { fireEvent, render, screen } from "../../../packages/supbrd-front-ui/render.js";

vi.mock("@superboard/front-ui/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: { id: "1-prod" } }),
}));

vi.mock(
	"../../../../../packages/plugins/superboard-acquisition/src/front/flows/features/flows/WorkflowsPage.js",
	() => ({
		FlowsWorkflowsPage: ({ onOpen }: { onOpen: (id: string) => void }) => (
			<button type="button" onClick={() => onOpen("workflow-1")}>
				Open workflow
			</button>
		),
	}),
);
vi.mock(
	"../../../../../packages/plugins/superboard-acquisition/src/front/flows/features/flows/editor/WorkflowEditorPage.js",
	() => ({
		WorkflowEditorPage: () => <input aria-label="Workflow draft" defaultValue="Saved" />,
	}),
);
vi.mock(
	"../../../../../packages/plugins/superboard-acquisition/src/front/flows/features/flows/LaunchpadPage.js",
	() => ({ LaunchpadPage: () => <p>Launchpad content</p> }),
);
vi.mock(
	"../../../../../packages/plugins/superboard-acquisition/src/front/flows/features/flows/ComponentsPage.js",
	() => ({ ComponentsPage: () => <p>Components content</p> }),
);

import { ExperienceFunctions } from "../../../../../packages/plugins/superboard-acquisition/src/front/ExperienceFunctions.js";

test("keeps an unsaved workflow mounted when switching the item section", () => {
	const changed = vi.fn();
	const view = render(<ExperienceFunctions section="Workflows" onDirtyChange={changed} />);
	fireEvent.click(screen.getByRole("button", { name: "Open workflow" }));
	fireEvent.change(screen.getByLabelText("Workflow draft"), { target: { value: "Unsaved work" } });
	for (const section of ["Design", "Launchpad", "Components"]) {
		view.rerender(<ExperienceFunctions section={section} onDirtyChange={changed} />);
		expect(screen.getByLabelText("Workflow draft")).not.toBeVisible();
	}
	view.rerender(<ExperienceFunctions section="Workflows" onDirtyChange={changed} />);
	expect(screen.getByLabelText("Workflow draft")).toBeVisible();
	expect(screen.getByLabelText("Workflow draft")).toHaveValue("Unsaved work");
});
