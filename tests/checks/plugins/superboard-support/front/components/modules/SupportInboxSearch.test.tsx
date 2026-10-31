import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "../../../../../packages/supbrd-front-ui/render.js";

const services = vi.hoisted(() => ({
	getUnifiedInboxItems: vi.fn(),
	getSupportContacts: vi.fn(),
}));

const item = (id: string, title: string, customer: string) => ({
	id: `conversation:${id}`,
	source_type: "conversation",
	source_id: id,
	title,
	preview: "Hello",
	status: "open",
	priority: "normal",
	customer_reference: customer,
	updated_at: "2026-10-01T00:00:00.000Z",
	destination: `/support/inbox?type=conversation&id=${id}`,
	capabilities: [],
	source: { external_user_id: customer },
});

vi.mock(
	"../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({ selectedProject: { id: "project-1", name: "Production" } }),
	}),
);
vi.mock(
	"../../../../../../../packages/plugins/superboard-support/src/front/api/support/inboxService.js",
	() => ({
		getUnifiedInboxItems: services.getUnifiedInboxItems,
		listInboxMacros: vi.fn().mockResolvedValue({ data: [] }),
		listInboxCannedResponses: vi.fn().mockResolvedValue({ data: [] }),
		getInboxMessages: vi.fn().mockResolvedValue({ data: [] }),
		markInboxConversationRead: vi.fn().mockResolvedValue({}),
		sendInboxMessage: vi.fn(),
		sendInboxAttachment: vi.fn(),
		setInboxConversationTyping: vi.fn(),
		uploadInboxAttachment: vi.fn(),
		downloadInboxAttachment: vi.fn(),
		updateInboxConversation: vi.fn(),
		createInboxRealtimeTicket: vi.fn(),
		inboxRealtimeUrl: vi.fn(),
		parseInboxRealtimeEvent: vi.fn(),
	}),
);
vi.mock(
	"../../../../../../../packages/plugins/superboard-support/src/front/api/support/operationsService.js",
	() => ({
		getSupportContacts: services.getSupportContacts,
		executeSupportMacro: vi.fn(),
		getSupportDraft: vi.fn().mockResolvedValue({ data: null }),
		saveSupportDraft: vi.fn(),
	}),
);
vi.mock(
	"../../../../../../../packages/plugins/superboard-support/src/front/api/support/workforceService.js",
	() => ({
		listSupportInboxes: vi.fn().mockResolvedValue({ data: [] }),
		listSupportMemberships: vi.fn().mockResolvedValue({ data: [] }),
		listSupportTeams: vi.fn().mockResolvedValue({ data: [] }),
	}),
);
vi.mock("../../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js", () => ({
	showErrorNotification: vi.fn(),
	showSuccessNotification: vi.fn(),
}));

import SupportInboxWorkspace from "../../../../../../../packages/plugins/superboard-support/src/front/components/modules/SupportInboxWorkspace.js";

describe("Support Inbox customer search", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Element.prototype.scrollIntoView ??= () => undefined;
		services.getUnifiedInboxItems.mockResolvedValue({
			data: [item("c-1", "Billing question", "user-1"), item("c-2", "Login issue", "user-2")],
			degraded_sources: [],
		});
		services.getSupportContacts.mockResolvedValue({
			data: [{ id: "contact-2", external_user_id: "user-2", email: "ada@example.test" }],
		});
	});

	it("opens the conversation list filtered to the customer from ?q=<email>", async () => {
		window.history.replaceState(null, "", "/support/inbox?q=ada%40example.test");
		render(<SupportInboxWorkspace />);

		expect(await screen.findByRole("searchbox", { name: "Search conversations" })).toHaveValue(
			"ada@example.test",
		);
		await waitFor(() =>
			expect(services.getSupportContacts).toHaveBeenCalledWith("project-1", "ada@example.test"),
		);
		const list = await screen.findByRole("complementary");
		await waitFor(() => expect(within(list).getByText("Login issue")).toBeInTheDocument());
		expect(within(list).queryByText("Billing question")).not.toBeInTheDocument();
	});

	it("filters by user id without a contact match", async () => {
		services.getSupportContacts.mockResolvedValue({ data: [] });
		window.history.replaceState(null, "", "/support/inbox?q=user-1");
		render(<SupportInboxWorkspace />);
		const list = await screen.findByRole("complementary");
		await waitFor(() => expect(within(list).getByText("Billing question")).toBeInTheDocument());
		expect(within(list).queryByText("Login issue")).not.toBeInTheDocument();
	});
});
