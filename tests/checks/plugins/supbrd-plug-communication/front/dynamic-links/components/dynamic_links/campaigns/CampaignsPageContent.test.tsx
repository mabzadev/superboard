import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../../../../../../packages/supbrd-front-ui/render.js";

const mocks = vi.hoisted(() => ({
	getAnalytics: vi.fn(),
	createCampaign: vi.fn(),
	push: vi.fn(),
	setSearchTerm: vi.fn(),
	setPage: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
	usePathname: () => "/dynamic-links/campaigns",
	useSearchParams: () => new URLSearchParams(),
}));

vi.mock(
	"../../../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({ selectedProject: { id: "10-test" } }),
	}),
);

vi.mock(
	"../../../../../../../../../packages/plugins/supbrd-plug-communication/src/front/dynamic-links/api/dynamic-links/dynamicLinksService.js",
	() => ({
		getLinkCampaignAnalytics: mocks.getAnalytics,
		createLinkCampaign: mocks.createCampaign,
	}),
);

vi.mock(
	"../../../../../../../../../packages/supbrd-front-ui/src/shared/hooks/useTableParams.js",
	() => ({
		useTableParams: () => ({
			page: 1,
			setPage: mocks.setPage,
			rowsPerPage: 25,
			setRowsPerPage: vi.fn(),
			sort: { sortKey: "created_at", ascending: false },
			setSort: vi.fn(),
			searchTerm: "",
			setSearchTerm: mocks.setSearchTerm,
			dateRange: {
				from: new Date("2026-07-01T00:00:00.000Z"),
				to: new Date("2026-08-01T00:00:00.000Z"),
			},
			setDateRange: vi.fn(),
			platform: "ios",
			setPlatform: vi.fn(),
		}),
	}),
);

vi.mock(
	"../../../../../../../../../packages/plugins/supbrd-plug-communication/src/front/dynamic-links/hooks/useUrlState.js",
	() => ({
		useUrlState: () => ["active", vi.fn()],
	}),
);

vi.mock(
	"../../../../../../../../../packages/supbrd-front-ui/src/shared/components/modules/ModulePage.js",
	() => ({
		ModulePage: ({ title, children }: { title: string; children: React.ReactNode }) => (
			<main>
				<h1>{title}</h1>
				{children}
			</main>
		),
		EmptyProject: () => <p>No project</p>,
		moduleErrorMessage: (error: unknown) => String(error),
	}),
);

vi.mock(
	"../../../../../../../../../packages/plugins/supbrd-plug-communication/src/front/dynamic-links/components/dynamic_links/campaigns/CampaignAnalyticsTable.js",
	() => ({
		CampaignAnalyticsTable: ({
			data,
			onOpenCampaign,
		}: {
			data: Array<{ id: string; name: string; total_views: number }>;
			onOpenCampaign: (id: string) => void;
		}) => (
			<div>
				{data.map((row) => (
					<button key={row.id} onClick={() => onOpenCampaign(row.id)}>
						{row.name}: {row.total_views} views
					</button>
				))}
			</div>
		),
	}),
);

vi.mock(
	"../../../../../../../../../packages/supbrd-front-ui/src/shared/components/dateRangePicker/DateRangePicker.js",
	() => ({
		DateRangePicker: () => <button>Date range</button>,
	}),
);

vi.mock(
	"../../../../../../../../../packages/supbrd-front-ui/src/shared/components/common/ads-platform.js",
	() => ({
		default: () => <button>Platforms</button>,
	}),
);

vi.mock(
	"../../../../../../../../../packages/supbrd-front-ui/src/shared/components/common/customize-columns.js",
	() => ({
		default: () => <button>Columns</button>,
	}),
);

vi.mock(
	"../../../../../../../../../packages/supbrd-front-ui/src/shared/components/common/pagination-footer.js",
	() => ({
		PaginationFooter: () => <div>Pagination</div>,
	}),
);

import CampaignsPageContent from "../../../../../../../../../packages/plugins/supbrd-plug-communication/src/front/dynamic-links/components/dynamic_links/campaigns/CampaignsPageContent.js";

describe("CampaignsPageContent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getAnalytics.mockResolvedValue([
			{
				id: "campaign-1",
				name: "Summer launch",
				slug: "summer-launch",
				status: "active",
				metadata: {},
				created_at: "2026-07-20T00:00:00.000Z",
				total_views: 42,
				total_opens: 30,
				total_installs: 20,
				total_reinstalls: 4,
				total_reactivations: 3,
				total_app_opens: 25,
				total_user_referred: 11,
				total_revenue: 9900,
			},
		]);
		mocks.createCampaign.mockResolvedValue({ id: "campaign-created" });
	});

	it("loads canonical analytics and opens a campaign detail route", async () => {
		render(<CampaignsPageContent />);

		const row = await screen.findByRole("button", {
			name: "Summer launch: 42 views",
		});
		expect(mocks.getAnalytics).toHaveBeenCalledWith(
			"10-test",
			expect.objectContaining({
				from: "2026-07-01",
				to: "2026-08-01",
				platform: "ios",
				interval: "day",
			}),
		);

		fireEvent.click(row);
		expect(mocks.push).toHaveBeenCalledWith("/dynamic-links/campaigns/campaign-1");
	});

	it("creates a campaign from the page CTA and navigates to it", async () => {
		render(<CampaignsPageContent />);
		await screen.findByText("Summer launch: 42 views");

		fireEvent.click(screen.getAllByRole("button", { name: /create campaign/i })[0]!);
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByPlaceholderText("Summer launch"), {
			target: { value: "Autumn launch" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Create campaign" }));

		await waitFor(() =>
			expect(mocks.createCampaign).toHaveBeenCalledWith("10-test", {
				name: "Autumn launch",
				slug: "autumn-launch",
				status: "active",
				metadata: { channel: "acquisition" },
			}),
		);
		expect(mocks.push).toHaveBeenCalledWith("/dynamic-links/campaigns/campaign-created");
	});
});
