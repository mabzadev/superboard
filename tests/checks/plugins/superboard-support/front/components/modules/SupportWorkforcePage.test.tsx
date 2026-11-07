import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
	fireEvent,
	render,
	screen,
	waitFor,
} from "../../../../../packages/supbrd-front-ui/render.js";

const services = vi.hoisted(() => ({
	listMemberships: vi.fn(),
	listTeams: vi.fn(),
	updateMembership: vi.fn(),
	createTeam: vi.fn(),
}));

vi.mock(
	"../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({
			selectedProject: { id: "project-1", name: "Production" },
			selectedInstance: { role: "owner" },
		}),
	}),
);

vi.mock(
	"../../../../../../../packages/plugins/superboard-support/src/front/api/support/workforceService.js",
	() => {
		const empty = vi.fn().mockResolvedValue({
			data: [],
			pagination: { limit: 50, has_more: false, next_cursor: null },
		});
		return {
			getWorkforceSummary: vi.fn().mockResolvedValue({
				data: {
					memberships: [],
					active_teams: 0,
					active_inboxes: 0,
					assignments: [],
					active_leaves: 0,
				},
			}),
			listSupportMemberships: services.listMemberships,
			listSupportTeams: services.listTeams,
			listSupportInboxes: empty,
			listSupportCapacityPolicies: empty,
			listSupportLeaves: empty,
			updateSupportMembership: services.updateMembership,
			createSupportTeam: services.createTeam,
		};
	},
);

vi.mock("../../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js", () => ({
	showErrorNotification: vi.fn(),
	showSuccessNotification: vi.fn(),
}));

import SupportWorkforcePage from "../../../../../../../packages/plugins/superboard-support/src/front/components/modules/SupportWorkforcePage.js";

const page = (data: unknown[]) => ({
	data,
	pagination: { limit: 50, has_more: false, next_cursor: null },
});

describe("Support agents and teams", () => {
	beforeAll(() => {
		if (!("PointerEvent" in window))
			Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });
	});

	beforeEach(() => {
		vi.clearAllMocks();
		services.listMemberships.mockResolvedValue(
			page([
				{
					id: "member-1",
					auth_user_id: "user-1",
					display_name: "Grace",
					role: "agent",
					availability: "online",
					active: true,
					capacity: 5,
					auto_offline: true,
				},
			]),
		);
		services.listTeams.mockResolvedValue(page([]));
		services.updateMembership.mockResolvedValue({ data: {} });
		services.createTeam.mockResolvedValue({ data: {} });
	});

	it("turns a member off with the switch on their row", async () => {
		render(<SupportWorkforcePage />);
		const member = await screen.findByRole("switch", { name: "Grace" });
		expect(member).toBeChecked();
		fireEvent.click(member);
		await waitFor(() =>
			expect(services.updateMembership).toHaveBeenCalledWith("project-1", "member-1", {
				active: false,
				availability: "offline",
			}),
		);
	});

	it("creates a team with automatic assignment switched off", async () => {
		const user = userEvent.setup();
		render(<SupportWorkforcePage />);
		await user.selectOptions(screen.getByRole("combobox", { name: "Show" }), "teams");
		await user.type(await screen.findByLabelText("Name"), "Billing");
		const assignment = screen.getByRole("switch", { name: "Automatic assignment" });
		expect(assignment).toBeChecked();
		fireEvent.click(assignment);
		await user.click(screen.getByRole("button", { name: "Create team" }));
		await waitFor(() =>
			expect(services.createTeam).toHaveBeenCalledWith(
				"project-1",
				expect.objectContaining({ name: "Billing", allow_auto_assign: false }),
			),
		);
	});
});
