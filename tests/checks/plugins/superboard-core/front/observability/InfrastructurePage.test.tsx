import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FrontContextProvider } from "../../../../../../packages/supbrd-front-ui/src/context.js";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../../../packages/supbrd-front-ui/render.js";

const platform = vi.hoisted(() => ({
	getPlatformStatus: vi.fn(),
	getPlatformCustomJobs: vi.fn(),
	getPlatformAccountErasures: vi.fn(),
	getPlatformEmailOperations: vi.fn(),
	replayPlatformEmailDeadLetter: vi.fn(),
	discardPlatformEmailDeadLetter: vi.fn(),
	retryPlatformCustomJob: vi.fn(),
}));
const transport = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));

vi.mock(
	"../../../../../../packages/plugins/superboard-core/src/front/observability/api/platform/platformService.js",
	() => platform,
);
vi.mock(
	"../../../../../../packages/plugins/superboard-core/src/front/observability/transport.js",
	() => transport,
);
vi.mock(
	"../../../../../../packages/plugins/superboard-core/src/front/observability/DeploymentConfiguration.js",
	() => ({ default: () => <h2>Running configuration</h2> }),
);

import InfrastructurePage from "../../../../../../packages/plugins/superboard-core/src/front/observability/app/(protected)/infrastructure/page.js";

function french({ children }: { children: ReactNode }) {
	return (
		<FrontContextProvider
			value={{
				instanceId: "1",
				pluginId: "superboard-observability",
				path: "/core/infrastructure",
				parameters: {},
				locale: "fr",
				operator: null,
				projectScope: null,
				activePluginIds: ["superboard-observability"],
			}}
		>
			{children}
		</FrontContextProvider>
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	platform.getPlatformStatus.mockResolvedValue({
		status: "ok",
		environment: "local",
		generatedAt: "2026-11-05T10:00:00Z",
		responseTimeMs: 12,
		deployment: { target: "mabza-development", release: "r-42", publicRouting: "staged" },
		catalog: {
			schemaVersion: 1,
			status: "ok",
			target: "mabza-development",
			environment: "local",
		},
		endpoints: { api: "https://api.example.test", files: null },
		api: { status: "ok", description: "Gateway", capabilities: [] },
		publicSurfaces: [
			{
				id: "site",
				url: "https://site.example.test",
				status: "ok",
				description: "Public site",
				responseTimeMs: 1500,
				httpStatus: 200,
			},
		],
		services: [
			{
				id: "email",
				workerName: "email-worker",
				status: "ok",
				description: "Email delivery",
				responseTimeMs: 40,
			},
		],
		dataStores: [],
		custom: { status: "disabled", manifest: null, stats: null },
		metrics: { users: 3, projects: 1 },
		jobs: {},
		runtime: null,
	});
	platform.getPlatformAccountErasures.mockResolvedValue([]);
	platform.getPlatformEmailOperations.mockResolvedValue({
		generatedAt: "2026-11-05T10:00:00Z",
		queue: null,
		messages: [],
		transportDeliveries: [],
		deadLetters: [
			{
				id: "dead-letter-1",
				queueMessageId: "queue-message-1",
				emailMessageId: null,
				sourceQueue: "email-delivery",
				jobType: "send",
				replayable: true,
				attempts: 3,
				status: "quarantined",
				resolution: null,
				receivedAt: "2026-11-05T09:00:00Z",
				resolvedAt: null,
			},
		],
	});
	platform.discardPlatformEmailDeadLetter.mockResolvedValue({
		id: "dead-letter-1",
		status: "discarded",
	});
	transport.GET.mockImplementation(async (path: string) => {
		if (path.startsWith("/api/v1/observability/incidents"))
			return {
				data: {
					data: {
						items: [
							{
								incident_id: "incident-1",
								service: "api",
								outcome: "exception",
								http_status: 500,
								occurrences: 4,
								status: "open",
								last_observed_at: "2026-11-05T09:30:00Z",
								resolution: null,
							},
						],
						nextCursor: null,
					},
				},
			};
		if (path.endsWith("/runtime-metrics")) return { data: { data: { rows: [] } } };
		return {
			data: {
				data: {
					items: [{ service: "api", status: "unhealthy", observed_at: "2026-11-05T09:59:00Z" }],
				},
			},
		};
	});
});

describe("Service health page", () => {
	it("renders the statuses and sections in French", async () => {
		render(<InfrastructurePage />, { wrapper: french });

		expect(
			screen.getByRole("heading", { level: 1, name: "État des services" }),
		).toBeInTheDocument();
		expect(await screen.findByRole("heading", { name: "Disponibilité publique" })).toBeVisible();
		expect(screen.getByRole("heading", { name: "Tâches de fond" })).toBeInTheDocument();
		expect(await screen.findByText("Ouvert")).toBeInTheDocument();
		expect(screen.getByText("En erreur")).toBeInTheDocument();
		expect(screen.getAllByText("Opérationnel").length).toBeGreaterThan(0);
		expect(screen.getByText(/1,5\s?s/u)).toBeInTheDocument();
		expect(screen.queryByText("Public availability")).toBeNull();
		expect(screen.queryByText("Background jobs")).toBeNull();
	});

	it("keeps technical sections in the Advanced area, after the health sections", async () => {
		render(<InfrastructurePage />);

		const advanced = await screen.findByRole("region", { name: "Advanced" });
		const area = within(advanced);
		expect(await area.findByRole("heading", { name: "Integration addresses" })).toBeVisible();
		expect(area.getByRole("heading", { name: "Workers" })).toBeVisible();
		expect(area.getByRole("heading", { name: "Worker observations" })).toBeVisible();
		expect(area.getByRole("heading", { name: "Running configuration" })).toBeVisible();
		expect(area.getByRole("link", { name: /https:\/\/api\.example\.test/u })).toBeVisible();
		expect(area.queryByRole("heading", { name: "Public availability" })).toBeNull();
		expect(area.queryByRole("heading", { name: "Observed incidents" })).toBeNull();
		expect(screen.getByRole("heading", { name: "Public availability" })).toBeVisible();
	});

	it("asks for confirmation before discarding a quarantined email", async () => {
		render(<InfrastructurePage />);

		fireEvent.click(
			await screen.findByRole("button", { name: "Discard email dead letter dead-letter-1" }),
		);
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("Discard this email?")).toBeInTheDocument();
		expect(platform.discardPlatformEmailDeadLetter).not.toHaveBeenCalled();

		fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
		await waitFor(() => {
			expect(platform.discardPlatformEmailDeadLetter).toHaveBeenCalledWith("dead-letter-1");
		});
	});

	it("resolves an incident only once a resolution is written", async () => {
		transport.POST.mockResolvedValue({ data: {} });
		render(<InfrastructurePage />);

		const resolve = await screen.findByRole("button", { name: "Resolve" });
		expect(resolve).toBeDisabled();
		fireEvent.change(screen.getByLabelText("Resolution"), {
			target: { value: "Restarted the API Worker" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
		await waitFor(() => {
			expect(transport.POST).toHaveBeenCalledWith(
				"/api/v1/observability/incidents/incident-1/resolve",
				{ resolution: "Restarted the API Worker" },
			);
		});
	});
});
