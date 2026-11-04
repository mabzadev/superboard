import userEvent from "@testing-library/user-event";
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

vi.mock("../../../../../../../packages/plugins/superboard-support/src/front/transport.js", () => ({
	GET: vi.fn(async (url: string) => ({
		data: url.endsWith("/workforce/inboxes/inbox-1")
			? {
					data: {
						id: "inbox-1",
						name: "Web support",
						identifier: "web-support",
						channel_type: "widget",
						status: "active",
						auto_assignment: true,
						allow_reopen: true,
						csat_enabled: true,
					},
				}
			: { data: [], pagination: { limit: 50, has_more: false, next_cursor: null } },
	})),
	POST: vi.fn(),
	PUT: vi.fn(),
	PATCH: vi.fn(),
	DELETE: vi.fn(),
	request: vi.fn(),
}));
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

import { FrontContextProvider } from "@superboard/front-ui/context";
import type { ReactNode } from "react";

import InboxPage from "../../../../../../../packages/plugins/superboard-support/src/front/components/modules/SupportInboxPage.js";
import SupportInboxWorkspace from "../../../../../../../packages/plugins/superboard-support/src/front/components/modules/SupportInboxWorkspace.js";

describe("Support Inbox customer search", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Element.prototype.scrollIntoView ??= () => undefined;
		globalThis.ResizeObserver ??= class {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
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

	it("shows the conversation next to the list and no empty column when nothing matches", async () => {
		window.history.replaceState(null, "", "/support/inbox?q=user-1");
		const { unmount } = render(<SupportInboxWorkspace />);
		await waitFor(() => expect(screen.getByLabelText("Status")).toHaveValue("open"));
		unmount();

		services.getSupportContacts.mockResolvedValue({ data: [] });
		window.history.replaceState(null, "", "/support/inbox?q=nobody%40example.test");
		render(<SupportInboxWorkspace />);
		expect(
			await screen.findByText("No conversations match nobody@example.test."),
		).toBeInTheDocument();
		expect(screen.queryByText("Select an Inbox item.")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
	});

	it.each(["/support/inbox?inbox=inbox-1&tab=conversations", "/support/inbox?inbox=inbox-1"])(
		"keeps the open inbox when a search started from %s is reloaded",
		async (address) => {
			services.getSupportContacts.mockResolvedValue({ data: [] });
			window.history.replaceState(null, "", address);
			const user = userEvent.setup();
			const { unmount } = render(<SupportInboxWorkspace />);
			await screen.findByRole("heading", { level: 1, name: "Web support" });
			if (!new URL(window.location.href).searchParams.has("tab"))
				await user.click(screen.getByRole("tab", { name: "Conversations" }));
			await user.type(
				await screen.findByRole("searchbox", { name: "Search conversations" }),
				"user-1",
			);
			await user.click(screen.getByRole("button", { name: "Search" }));
			const searched = new URL(window.location.href);
			expect(searched.searchParams.get("inbox")).toBe("inbox-1");
			expect(searched.searchParams.get("q")).toBe("user-1");
			unmount();
			services.getUnifiedInboxItems.mockClear();

			render(<SupportInboxWorkspace />);

			expect(await screen.findByRole("heading", { level: 1, name: "Web support" })).toBeVisible();
			expect(screen.queryByRole("heading", { level: 1, name: "Inbox" })).not.toBeInTheDocument();
			expect(screen.getByRole("tab", { name: "Conversations" })).toHaveAttribute(
				"aria-selected",
				"true",
			);
			expect(await screen.findByRole("searchbox", { name: "Search conversations" })).toHaveValue(
				"user-1",
			);
			await waitFor(() =>
				expect(services.getUnifiedInboxItems).toHaveBeenCalledWith(
					"project-1",
					expect.objectContaining({ inbox_id: "inbox-1" }),
				),
			);
			const list = await screen.findByRole("complementary");
			await waitFor(() => expect(within(list).getByText("Billing question")).toBeInTheDocument());
			expect(within(list).queryByText("Login issue")).not.toBeInTheDocument();
		},
	);

	it("opens the conversations of an inbox from a link that carries a search", async () => {
		services.getSupportContacts.mockResolvedValue({ data: [] });
		window.history.replaceState(null, "", "/support/inbox?inbox=inbox-1&q=user-1");
		render(<SupportInboxWorkspace />);
		expect(await screen.findByRole("tab", { name: "Conversations" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		expect(await screen.findByRole("searchbox", { name: "Search conversations" })).toHaveValue(
			"user-1",
		);
	});

	it("shows the open conversation in French", async () => {
		window.history.replaceState(null, "", "/support/inbox?q=user-1&lang=fr");
		const french = ({ children }: { children: ReactNode }) => (
			<FrontContextProvider
				value={{
					instanceId: "1",
					pluginId: "superboard-support",
					path: "/support/inbox",
					parameters: {},
					locale: "fr",
					operator: null,
					projectScope: null,
					activePluginIds: ["superboard-support"],
				}}
			>
				{children}
			</FrontContextProvider>
		);
		const { container } = render(<InboxPage />, { wrapper: french });

		expect(await screen.findByPlaceholderText("Répondez au client…")).toBeVisible();
		expect(screen.getByText("Environnement du support isolé")).toBeVisible();
		expect(screen.getByRole("button", { name: "Actualiser" })).toBeVisible();
		expect(screen.getByRole("combobox", { name: "Filtrer par statut" })).toHaveDisplayValue(
			"Tous les statuts",
		);
		expect(screen.getByRole("combobox", { name: "Statut" })).toHaveDisplayValue("Ouverte");
		expect(screen.getByRole("combobox", { name: "Priorité" })).toHaveDisplayValue("Normale");
		expect(screen.getByRole("button", { name: "Appliquer la macro" })).toBeDisabled();
		expect(screen.getByText("Note privée — visible uniquement par les agents")).toBeVisible();
		expect(screen.getByRole("button", { name: /Envoyer/ })).toBeDisabled();
		expect(container.textContent).not.toMatch(
			/Isolated Support runtime|All conversations|Refresh|Customer|Private note|Apply macro|Normal\b/,
		);
	});

	it("does not repeat the Inbox title inside an inbox", async () => {
		window.history.replaceState(null, "", "/support/inbox?inbox=inbox-1&tab=conversations");
		render(<InboxPage inboxId="inbox-1" />);
		expect(await screen.findByRole("searchbox", { name: "Search conversations" })).toBeVisible();
		expect(screen.queryByRole("heading", { name: "Inbox" })).not.toBeInTheDocument();
	});
});
