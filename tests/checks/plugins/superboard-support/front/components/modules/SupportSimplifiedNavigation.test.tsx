import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../../../../packages/supbrd-front-ui/render.js";

const transport = vi.hoisted(() => {
	const page = (data: unknown[]) => ({
		data,
		pagination: { limit: 50, has_more: false, next_cursor: null },
	});
	const inbox = {
		id: "inbox-1",
		name: "Web support",
		identifier: "web-support",
		channel_type: "widget",
		status: "active",
		auto_assignment: true,
		allow_reopen: true,
		csat_enabled: true,
	};
	const portal = {
		id: "portal-1",
		name: "Customer help",
		slug: "customer-help",
		locale: "en",
		status: "draft",
		custom_domain: null,
	};
	const contact = {
		id: "contact-1",
		external_user_id: "user-1",
		name: "Ada Lovelace",
		email: "ada@example.test",
		phone: null,
		company_id: null,
		blocked: false,
		custom_attributes: {},
		conversation_count: 2,
		updated_at: "2026-10-01T00:00:00.000Z",
	};
	const dimensions = {
		inbox: [{ dimension: "Web support", conversations: 3 }],
		agent: [{ dimension: "Grace", conversations: 5 }],
		team: [],
		label: [],
		channel: [],
		provider: [],
	};
	const routes: Array<[RegExp, unknown]> = [
		[/\/workforce\/inboxes\/inbox-1$/, { data: inbox }],
		[/\/help-center\/portals\/portal-1$/, { data: portal }],
		[/\/contacts\/contact-1\/notes$/, { data: [] }],
		[/\/contacts\/contact-1$/, { data: { ...contact, conversations: [] } }],
		[/\/contacts$/, { data: [contact] }],
		[/\/companies$/, { data: [] }],
		[
			/\/reports$/,
			{
				data: {
					totals: {
						conversations: 3,
						backlog: 0,
						resolved: 3,
						first_response_seconds: null,
						resolution_seconds: null,
					},
					csat: { average: null, responses: 0 },
					sla: [],
					dimensions,
					proactive_support: [],
				},
			},
		],
	];
	const GET = vi.fn(async (url: string) => {
		const path = url.split("?")[0] ?? url;
		const match = routes.find(([pattern]) => pattern.test(path));
		return { data: match ? match[1] : page([]) };
	});
	const PATCH = vi.fn(async (_url: string, body: Record<string, unknown>) => ({
		data: { data: { ...(String(_url).includes("portals") ? portal : inbox), ...body } },
	}));
	return { GET, PATCH };
});

vi.mock("../../../../../../../packages/plugins/superboard-support/src/front/transport.js", () => ({
	GET: transport.GET,
	POST: vi.fn(),
	PUT: vi.fn(),
	PATCH: transport.PATCH,
	DELETE: vi.fn(),
	request: vi.fn(),
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
vi.mock("../../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js", () => ({
	showErrorNotification: vi.fn(),
	showSuccessNotification: vi.fn(),
}));

import SupportAutomationsPage from "../../../../../../../packages/plugins/superboard-support/src/front/components/modules/SupportAutomationsPage.js";
import SupportContactsPage from "../../../../../../../packages/plugins/superboard-support/src/front/components/modules/SupportContactsPage.js";
import SupportHelpCenterWorkspace from "../../../../../../../packages/plugins/superboard-support/src/front/components/modules/SupportHelpCenterWorkspace.js";
import SupportInboxWorkspace from "../../../../../../../packages/plugins/superboard-support/src/front/components/modules/SupportInboxWorkspace.js";
import SupportReportsPage from "../../../../../../../packages/plugins/superboard-support/src/front/components/modules/SupportReportsPage.js";

const tabNames = (list: HTMLElement) =>
	within(list)
		.getAllByRole("tab")
		.map((tab) => tab.textContent);

describe("Support pages keep a single navigation row", () => {
	beforeAll(() => {
		if (!("PointerEvent" in window))
			Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });
	});

	beforeEach(() => {
		vi.clearAllMocks();
		globalThis.ResizeObserver ??= class {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	});

	it("shows an inbox on one row of tabs and maps legacy settings sections onto it", async () => {
		window.history.replaceState(
			null,
			"",
			"/support/inbox?inbox=inbox-1&tab=settings&section=members&lang=en",
		);
		const user = userEvent.setup();
		render(<SupportInboxWorkspace />);

		expect(await screen.findByRole("heading", { level: 1, name: "Web support" })).toBeVisible();
		const [row, ...nested] = screen.getAllByRole("tablist");
		expect(nested).toHaveLength(0);
		expect(tabNames(row!)).toEqual([
			"Conversations",
			"General",
			"Connections",
			"Members",
			"Inbox automations",
			"Proactive Support",
			"Reports",
		]);
		expect(screen.getByRole("tab", { name: "Members" })).toHaveAttribute("aria-selected", "true");

		await user.click(screen.getByRole("tab", { name: "Connections" }));
		const url = new URL(window.location.href);
		expect(url.searchParams.get("tab")).toBe("channels");
		expect(url.searchParams.has("section")).toBe(false);
		expect(await screen.findByRole("heading", { name: "Connections" })).toBeVisible();
		expect(screen.getByRole("heading", { name: "Channels" })).toBeVisible();
		expect(screen.getAllByRole("tablist")).toHaveLength(1);
	});

	it.each(["tab=settings", "tab=unknown", ""])(
		"opens the inbox settings when the link carries %s",
		async (query) => {
			window.history.replaceState(null, "", `/support/inbox?inbox=inbox-1&${query}`);
			render(<SupportInboxWorkspace />);
			expect(await screen.findByRole("tab", { name: "General" })).toHaveAttribute(
				"aria-selected",
				"true",
			);
			expect(screen.getByLabelText("Identifier")).toHaveValue("web-support");
		},
	);

	it("saves an inbox setting as soon as its switch changes", async () => {
		window.history.replaceState(null, "", "/support/inbox?inbox=inbox-1&tab=general");
		render(<SupportInboxWorkspace />);
		const satisfaction = await screen.findByRole("switch", { name: "Customer satisfaction" });
		expect(satisfaction).toBeChecked();
		expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
		fireEvent.click(satisfaction);
		await waitFor(
			() =>
				expect(transport.PATCH).toHaveBeenCalledWith(
					expect.stringMatching(/\/workforce\/inboxes\/inbox-1$/),
					expect.objectContaining({ name: "Web support", csat_enabled: false }),
					expect.anything(),
				),
			{ timeout: 3000 },
		);
	});

	it("saves the help center portal settings automatically and never an empty name", async () => {
		window.history.replaceState(null, "", "/support/help-center?portal=portal-1&tab=settings");
		render(<SupportHelpCenterWorkspace />);
		const name = await screen.findByLabelText("Name");
		fireEvent.change(name, { target: { value: "" } });
		expect(await screen.findByText("This field is required.")).toBeVisible();
		await new Promise((resolve) => {
			setTimeout(resolve, 900);
		});
		expect(transport.PATCH).not.toHaveBeenCalled();
		fireEvent.change(name, { target: { value: "Help" } });
		await waitFor(
			() =>
				expect(transport.PATCH).toHaveBeenCalledWith(
					expect.stringMatching(/\/help-center\/portals\/portal-1$/),
					expect.objectContaining({ name: "Help", slug: "customer-help", custom_domain: null }),
					expect.anything(),
				),
			{ timeout: 3000 },
		);
	});

	it("chooses the automation type from the toolbar instead of sub-tabs", async () => {
		window.history.replaceState(null, "", "/support/inbox?section=automations");
		const user = userEvent.setup();
		render(<SupportAutomationsPage />);

		const type = await screen.findByRole("combobox", { name: "Automation type" });
		expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
		expect(
			within(type)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["Rules", "Assignment", "SLA", "Business hours", "Macros", "Canned responses"]);
		expect(screen.getByText("New automation")).toBeVisible();

		await user.selectOptions(type, "sla");
		expect(await screen.findByText("New SLA policy")).toBeVisible();
		expect(screen.queryByText("New automation")).not.toBeInTheDocument();
		expect(screen.getByRole("combobox", { name: "Automation type" })).toHaveValue("sla");
	});

	it("offers only inbox-level automation types inside an inbox", async () => {
		window.history.replaceState(null, "", "/support/inbox?inbox=inbox-1&tab=automations");
		render(<SupportAutomationsPage inboxId="inbox-1" />);
		const type = await screen.findByRole("combobox", { name: "Automation type" });
		expect(within(type).queryByRole("option", { name: "Macros" })).not.toBeInTheDocument();
		expect(
			within(type).queryByRole("option", { name: "Canned responses" }),
		).not.toBeInTheDocument();
	});

	it("switches report breakdowns with a selector", async () => {
		const user = userEvent.setup();
		render(<SupportReportsPage />);

		expect(await screen.findByText("Inbox volume")).toBeVisible();
		await waitFor(() => expect(screen.getByText("Web support")).toBeVisible());
		expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
		await user.selectOptions(screen.getByRole("combobox", { name: "Breakdown" }), "agent");
		expect(screen.getByText("Agent load")).toBeVisible();
		expect(screen.getByText("Grace")).toBeVisible();
		expect(screen.queryByText("Web support")).not.toBeInTheDocument();
	});

	it("opens a Help Center portal on one row of tabs and maps the legacy content tab", async () => {
		window.history.replaceState(null, "", "/support/help-center?portal=portal-1&tab=content");
		const user = userEvent.setup();
		render(<SupportHelpCenterWorkspace />);

		expect(await screen.findByRole("heading", { level: 1, name: "Customer help" })).toBeVisible();
		const [row, ...nested] = screen.getAllByRole("tablist");
		expect(nested).toHaveLength(0);
		expect(tabNames(row!)).toEqual([
			"Articles",
			"Structure",
			"Translations",
			"Settings",
			"Reports",
		]);
		expect(screen.getByRole("tab", { name: "Articles" })).toHaveAttribute("aria-selected", "true");
		expect(await screen.findByText("New article")).toBeVisible();

		await user.click(screen.getByRole("tab", { name: "Structure" }));
		expect(new URL(window.location.href).searchParams.get("tab")).toBe("structure");
		expect(await screen.findByText("New category")).toBeVisible();
		expect(screen.getByText("New folder")).toBeVisible();
		expect(screen.getAllByRole("tablist")).toHaveLength(1);
	});

	it("replaces the contact list with the contact and returns to it", async () => {
		window.history.replaceState(null, "", "/support/inbox?section=contacts");
		const user = userEvent.setup();
		render(<SupportContactsPage embedded />);

		const row = await screen.findByRole("button", { name: /Ada Lovelace/ });
		expect(screen.queryByRole("heading", { name: "Contacts" })).not.toBeInTheDocument();
		expect(screen.queryByText("Edit contact")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("Customer ID")).not.toBeInTheDocument();

		await user.click(row);
		expect(new URL(window.location.href).searchParams.get("contact")).toBe("contact-1");
		expect(await screen.findByRole("heading", { name: "Edit contact" })).toBeVisible();
		expect(screen.getByLabelText("Customer ID")).toHaveValue("user-1");
		expect(screen.queryByRole("button", { name: /Ada Lovelace/ })).not.toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Conversation history" })).toBeVisible();

		await user.click(screen.getByRole("button", { name: "All contacts" }));
		expect(new URL(window.location.href).searchParams.has("contact")).toBe(false);
		expect(new URL(window.location.href).searchParams.get("section")).toBe("contacts");
		expect(await screen.findByRole("button", { name: /Ada Lovelace/ })).toBeVisible();

		await user.click(screen.getByRole("button", { name: "New contact" }));
		expect(new URL(window.location.href).searchParams.get("contact")).toBe("new");
		expect(await screen.findByRole("heading", { name: "New contact" })).toBeVisible();
		expect(screen.getByLabelText("Customer ID")).toHaveValue("");
	});

	it("opens a contact directly from its address", async () => {
		window.history.replaceState(null, "", "/support/inbox?section=contacts&contact=contact-1");
		render(<SupportContactsPage embedded />);
		await waitFor(() => expect(screen.getByLabelText("Customer ID")).toHaveValue("user-1"));
		expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
	});
});
