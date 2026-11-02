import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { fetchBylines } from "../../../../../packages/admin/src/lib/api";
import { BylinesPage } from "../../../../../packages/admin/src/routes/bylines";
import { render } from "../utils/render.tsx";
import { QueryWrapper } from "../utils/test-helpers.tsx";

vi.mock("@tanstack/react-router", async () => {
	const actual = await vi.importActual("@tanstack/react-router");
	return {
		...actual,
		useNavigate: () => vi.fn(),
		useSearch: () => ({}),
	};
});

vi.mock("../../../../../packages/admin/src/lib/api/client.js", async () => {
	const actual = await vi.importActual("../../../../../packages/admin/src/lib/api/client.js");
	return {
		...actual,
		fetchManifest: vi.fn().mockResolvedValue({}),
	};
});

vi.mock("../../../../../packages/admin/src/lib/api", async () => {
	const actual = await vi.importActual("../../../../../packages/admin/src/lib/api");
	return {
		...actual,
		fetchBylines: vi.fn(),
		fetchUsers: vi.fn().mockResolvedValue({ items: [] }),
		fetchByline: vi.fn().mockResolvedValue(null),
		fetchBylineTranslations: vi.fn().mockResolvedValue({ items: [] }),
	};
});

const fetchBylinesMock = vi.mocked(fetchBylines);

function searchArgs(): (string | undefined)[] {
	return fetchBylinesMock.mock.calls.map((call) => call[0]?.search);
}

describe("BylinesPage search", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fetchBylinesMock.mockResolvedValue({ items: [], nextCursor: undefined });
	});

	it("debounces rapid typing into a single refetch and keeps the input mounted", async () => {
		vi.useFakeTimers();
		try {
			const screen = await render(
				<QueryWrapper>
					<BylinesPage />
				</QueryWrapper>,
			);

			await vi.advanceTimersByTimeAsync(0);
			expect(searchArgs()).toEqual([undefined]);

			const input = screen.getByPlaceholder("Search bylines");
			await expect.element(input).toBeInTheDocument();

			await input.fill("a");
			await input.fill("al");
			await input.fill("ali");

			expect(searchArgs()).toEqual([undefined]);
			await expect.element(input).toHaveValue("ali");

			await vi.advanceTimersByTimeAsync(300);
			await vi.waitFor(() => {
				expect(searchArgs()).toEqual([undefined, "ali"]);
			});

			await expect.element(screen.getByPlaceholder("Search bylines")).toBeInTheDocument();
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps the previous results mounted while a search refetch is in flight", async () => {
		vi.useFakeTimers();
		try {
			let resolveSearch: (value: { items: unknown[]; nextCursor: undefined }) => void = () => {};
			const pendingSearch = new Promise<{ items: unknown[]; nextCursor: undefined }>((resolve) => {
				resolveSearch = resolve;
			});
			fetchBylinesMock
				.mockResolvedValueOnce({
					items: [
						{ id: "1", slug: "alice", displayName: "Alice Example", isGuest: false, userId: null },
					],
					nextCursor: undefined,
				} as never)
				.mockReturnValueOnce(pendingSearch as never);

			const screen = await render(
				<QueryWrapper>
					<BylinesPage />
				</QueryWrapper>,
			);

			await vi.advanceTimersByTimeAsync(0);
			await expect.element(screen.getByText("Alice Example")).toBeInTheDocument();

			const input = screen.getByPlaceholder("Search bylines");
			await input.fill("ali");

			await vi.advanceTimersByTimeAsync(300);
			await vi.waitFor(() => {
				expect(searchArgs()).toEqual([undefined, "ali"]);
			});

			await expect.element(screen.getByPlaceholder("Search bylines")).toBeInTheDocument();
			await expect.element(screen.getByText("Alice Example")).toBeInTheDocument();

			resolveSearch({ items: [], nextCursor: undefined });
		} finally {
			vi.useRealTimers();
		}
	});
});
