import { describe, expect, it, vi } from "vitest";

import { render, screen } from "../../../../../../packages/supbrd-front-ui/render.js";

vi.mock(
	"../../../../../../../../packages/plugins/superboard-acquisition/src/front/flows/features/flows/FlowsContext.js",
	() => ({
		useFlows: () => ({ projectRef: "test-project" }),
	}),
);

const getUser = vi.hoisted(() => vi.fn());

vi.mock(
	"../../../../../../../../packages/plugins/superboard-acquisition/src/front/flows/api/flows/flowsService.js",
	() => ({ flowsApi: { getUser, resetUser: vi.fn() } }),
);

import { FlowUserDetailsPage } from "../../../../../../../../packages/plugins/superboard-acquisition/src/front/flows/features/flows/UserDetailsPage.js";

describe("FlowUserDetailsPage", () => {
	it("shows workflow state and activity together instead of behind tabs", async () => {
		getUser.mockResolvedValue({
			profiles: [],
			workflow_states: [
				{
					workflow_id: "workflow-1",
					workflow_name: "Welcome tour",
					workflow_identifier: "welcome_tour",
					state: "in-progress",
					active_block_ids: ["block-1"],
					updated_at: "2026-10-01T10:00:00Z",
				},
			],
			events: [
				{
					event_id: "event-1",
					event_name: "block_shown",
					block_key: "intro",
					occurred_at: "2026-10-01T10:00:00Z",
					properties: {},
				},
			],
		});
		render(<FlowUserDetailsPage userHash="user-hash" />);
		expect(await screen.findByText("Welcome tour")).toBeVisible();
		expect(screen.getByText("block_shown · intro")).toBeVisible();
		expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
		expect(
			screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
		).toEqual(["Workflow state", "Activity"]);
	});
});
