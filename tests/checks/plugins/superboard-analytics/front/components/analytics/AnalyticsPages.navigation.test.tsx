import { FrontContextProvider, type FrontContextValue } from "@superboard/front-ui/context";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	sessions: vi.fn(),
	profiles: vi.fn(),
	alerts: vi.fn(),
	crashes: vi.fn(),
	crash: vi.fn(),
	updateCrash: vi.fn(),
	dimensions: vi.fn(),
}));

vi.mock(
	"../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({
			selectedProject: { id: "project-1", name: "Reference application" },
			projectType: "production",
		}),
	}),
);
vi.mock("../../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js", () => ({
	showErrorNotification: vi.fn(),
	showSuccessNotification: vi.fn(),
}));
vi.mock(
	"../../../../../../../packages/plugins/superboard-analytics/src/front/api/analytics/analyticsService.js",
	() => ({
		getAnalyticsSessions: state.sessions,
		getAnalyticsProfiles: state.profiles,
		getAnalyticsAlerts: state.alerts,
		getAnalyticsCrashes: state.crashes,
		getAnalyticsCrash: state.crash,
		updateAnalyticsCrash: state.updateCrash,
		getAnalyticsDimensions: state.dimensions,
	}),
);

import {
	AnalyticsPage,
	type AnalyticsPageKind,
} from "../../../../../../../packages/plugins/superboard-analytics/src/front/components/analytics/AnalyticsPages.js";

function Page({ kind, locale = "en" }: { kind: AnalyticsPageKind; locale?: "en" | "fr" }) {
	const context: FrontContextValue = {
		locale,
		path: window.location.pathname,
		parameters: {},
		instanceId: "instance-1",
		pluginId: "superboard-analytics",
		operator: null,
		projectScope: null,
		activePluginIds: ["superboard-analytics"],
	};
	return (
		<FrontContextProvider value={context}>
			<AnalyticsPage kind={kind} />
		</FrontContextProvider>
	);
}

const crash = {
	application_id: "app-1",
	fingerprint: "fp-checkout",
	title: "Checkout crashed",
	fatal: true,
	resolved: false,
	occurrence_count: 3,
	affected_profiles: 2,
	first_seen_at: "2026-10-01T10:00:00Z",
	last_seen_at: "2026-10-02T10:00:00Z",
	last_app_version: "3.2.0",
	last_platform: "ios",
	occurrences: [
		{
			id: "occurrence-1",
			message: "Null cart",
			stack: "at Checkout.submit",
			occurred_at: "2026-10-02T10:00:00Z",
		},
	],
};

describe("Analytics pages keep one navigation row per screen", () => {
	beforeAll(() => {
		Element.prototype.hasPointerCapture ??= () => false;
		Element.prototype.releasePointerCapture ??= () => undefined;
		Element.prototype.scrollIntoView ??= () => undefined;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		state.sessions.mockResolvedValue({ items: [] });
		state.profiles.mockResolvedValue({
			items: [
				{
					id: "profile-1",
					application_id: "app-1",
					last_seen_at: "2026-10-02T10:00:00Z",
					properties: { plan: "pro" },
				},
			],
		});
		state.alerts.mockResolvedValue({
			items: [
				{
					id: "alert-1",
					name: "Crash spike",
					alert_type: "crash_spike",
					enabled: true,
					cooldown_minutes: 60,
				},
			],
			incidents: [
				{
					id: "incident-1",
					alert_id: "alert-1",
					status: "open",
					summary: "Crashes doubled",
					value: {},
					notification_status: "sent",
					notifications: [],
					triggered_at: "2026-10-02T10:00:00Z",
				},
			],
		});
		state.crashes.mockResolvedValue({ items: [crash] });
		state.crash.mockResolvedValue(crash);
		state.updateCrash.mockResolvedValue({});
		state.dimensions.mockResolvedValue({
			dimensions: {
				platform: [{ value: "ios", events: 12, users: 4 }],
				country_code: [{ value: "FR", events: 9, users: 3 }],
			},
		});
	});

	afterEach(() => {
		window.history.replaceState(null, "", "/");
	});

	it("opens user profiles as a tab of the audience row instead of a nested tab", async () => {
		window.history.replaceState(null, "", "/analytics/users?tab=profiles&lang=en");
		render(<Page kind="users" />);
		expect(await screen.findByText("Pseudonymized profiles")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "User profiles" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.queryByRole("tablist")).toBeNull();
		expect(screen.queryByText("Recent sessions")).toBeNull();
		expect(state.profiles).toHaveBeenCalledWith("project-1");
		expect(state.sessions).not.toHaveBeenCalled();
	});

	it.each(["", "?tab=users"])("opens sessions first for the audience link %s", async (query) => {
		window.history.replaceState(null, "", `/analytics/users${query}`);
		render(<Page kind="users" />);
		expect(await screen.findByText("Recent sessions")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Sessions" })).toHaveAttribute("aria-current", "page");
		expect(screen.queryByText("Pseudonymized profiles")).toBeNull();
	});

	it("shows alert rules and incidents together under the alerts tab", async () => {
		window.history.replaceState(null, "", "/analytics/reports?tab=alerts&lang=fr");
		render(<Page kind="reports" locale="fr" />);
		expect(await screen.findByText("Crashes doubled")).toBeInTheDocument();
		expect(screen.getByText("Règles actives")).toBeInTheDocument();
		expect(screen.getByText("Historique des incidents")).toBeInTheDocument();
		expect(screen.getByText("1 ouvert")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Alertes" })).toHaveAttribute("aria-current", "page");
		expect(screen.queryByRole("tablist")).toBeNull();
		expect(screen.getAllByRole("navigation")).toHaveLength(1);
	});

	it("replaces the crash list with the selected crash and returns to the list", async () => {
		window.history.replaceState(null, "", "/analytics/reports?tab=crashes&lang=en");
		const user = userEvent.setup();
		render(<Page kind="reports" />);
		await user.click(await screen.findByText("Checkout crashed"));

		await waitFor(() =>
			expect(new URLSearchParams(window.location.search).get("crash")).toBe("fp-checkout"),
		);
		expect(await screen.findByText("at Checkout.submit")).toBeInTheDocument();
		expect(screen.queryByRole("table")).toBeNull();
		expect(state.crash).toHaveBeenCalledWith("project-1", "fp-checkout");
		expect(new URLSearchParams(window.location.search).get("tab")).toBe("crashes");

		await user.click(screen.getByRole("button", { name: "All crash groups" }));
		await waitFor(() => expect(window.location.search).toBe("?tab=crashes&lang=en"));
		expect(await screen.findByRole("table")).toBeInTheDocument();
		expect(screen.queryByText("at Checkout.submit")).toBeNull();
	});

	it("opens a linked crash directly and goes back to the list once resolved", async () => {
		window.history.replaceState(null, "", "/analytics/reports?tab=crashes&crash=fp-checkout");
		const user = userEvent.setup();
		render(<Page kind="reports" />);
		await user.click(await screen.findByRole("button", { name: "Mark as resolved" }));
		expect(state.updateCrash).toHaveBeenCalledWith("project-1", "fp-checkout", {
			resolved: true,
		});
		await waitFor(() => expect(window.location.search).toBe("?tab=crashes"));
		expect(await screen.findByRole("table")).toBeInTheDocument();
	});

	it("reports a crash that cannot be loaded instead of waiting forever", async () => {
		state.crash.mockRejectedValue(new Error("Crash group not found"));
		window.history.replaceState(null, "", "/analytics/reports?tab=crashes&crash=missing");
		render(<Page kind="reports" />);
		expect(await screen.findByText("Crash group not found")).toBeInTheDocument();
		await waitFor(() => expect(state.crashes).toHaveBeenCalled());
		expect(screen.getByText("Crash group not found")).toBeInTheDocument();
		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.getByRole("button", { name: "All crash groups" })).toBeInTheDocument();
	});

	it("switches the device and country list with a dimension filter", async () => {
		window.history.replaceState(null, "", "/analytics/users?tab=dimensions");
		const user = userEvent.setup();
		render(<Page kind="users" />);
		expect(await screen.findByText("ios")).toBeInTheDocument();
		expect(screen.queryByRole("tablist")).toBeNull();

		await user.click(screen.getByRole("combobox", { name: "Dimension" }));
		await user.click(await screen.findByRole("option", { name: "Country Code" }));

		expect(await screen.findByText("FR")).toBeInTheDocument();
		expect(screen.queryByText("ios")).toBeNull();
	});
});
