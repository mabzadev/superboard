import { describe, expect, it, vi } from "vitest";

import {
	fireEvent,
	render,
	screen,
} from "../../../../../../../../../../supbrd-front-ui/tests/render.js";

vi.mock(
	"../../../../../../../../../../supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({
			selectedProject: { id: "10-test", name: "Test" },
		}),
	}),
);
vi.mock("../../../../../../../../../../supbrd-front-ui/src/shared/hooks/useTableParams.js", () => ({
	useTableParams: () => ({
		page: 1,
		setPage: vi.fn(),
		rowsPerPage: 20,
		setRowsPerPage: vi.fn(),
		sort: undefined,
		setSort: vi.fn(),
		searchTerm: "",
		setSearchTerm: vi.fn(),
	}),
}));
vi.mock("../../../../../supbrd-plugmod-dynamic-links/source/hooks/useUrlState.js", () => ({
	useUrlState: (_key: string, initial: string) => [initial, vi.fn()],
}));
vi.mock("../../../hooks/queries/useNotificationsQueries.js", () => ({
	useNotificationsQuery: () => ({
		data: {
			data: [{ id: "message-1", title: "Welcome customers" }],
			totalPages: 2,
			totalEntries: 21,
		},
		isLoading: false,
		refetch: vi.fn(),
	}),
}));
vi.mock("../../messaging/MessagingTableColumns.js", () => ({
	getMessagingTableColumns: () => [],
}));
vi.mock("../../messaging/MessagingTable.js", () => ({
	default: ({
		data,
		handleSelectRow,
	}: {
		data: Array<{ id: string; title: string }>;
		handleSelectRow: (item: { id: string; title: string }) => void;
	}) => (
		<div aria-label="In-app messages table">
			{data.map((item) => (
				<button key={item.id} onClick={() => handleSelectRow(item)}>
					{item.title}
				</button>
			))}
		</div>
	),
}));
vi.mock(
	"../../../../../../../../../../supbrd-front-ui/src/shared/components/common/ads-platform.js",
	() => ({
		default: () => <button>Target users</button>,
	}),
);
vi.mock(
	"../../../../../../../../../../supbrd-front-ui/src/shared/components/common/customize-columns.js",
	() => ({
		default: () => <button>Customize columns</button>,
	}),
);
vi.mock("../../../../../../../../../../supbrd-front-ui/tests/empty-shell.js", () => ({
	default: () => <header>In-app Messages</header>,
}));
vi.mock(
	"../../../../../../../../../../supbrd-front-ui/src/shared/components/common/pagination-footer.js",
	() => ({
		PaginationFooter: ({ totalRows }: { totalRows: number }) => (
			<div>Pagination for {totalRows} messages</div>
		),
	}),
);
vi.mock("../../craft/DynamicEditor.js", () => ({
	default: ({ open }: { open: boolean }) => (open ? <div>Message editor open</div> : null),
}));
vi.mock(
	"../../../../../../../../../../supbrd-front-ui/src/shared/components/ui/popover.js",
	() => ({
		Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
		PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
		PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	}),
);
vi.mock(
	"../../../../../../../../../../supbrd-front-ui/src/shared/components/ui/checkbox.js",
	() => ({
		Checkbox: () => <input type="checkbox" readOnly />,
	}),
);

import InAppMessagesPage from "../InAppMessagesPage.js";

describe("Marketing In-app Messages parity", () => {
	it("keeps the Grovs search, status, targeting, table, create, and pagination surface", () => {
		render(<InAppMessagesPage />);

		expect(screen.getByPlaceholderText("Search message")).toBeInTheDocument();
		expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
		expect(screen.getByText("Target users")).toBeInTheDocument();
		expect(screen.getByText("Customize columns")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /create message/i })).toBeInTheDocument();
		expect(screen.getByLabelText("In-app messages table")).toBeInTheDocument();
		expect(screen.getByText("Pagination for 21 messages")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Welcome customers" }));
		expect(screen.getByText("Message editor open")).toBeInTheDocument();
	});
});
