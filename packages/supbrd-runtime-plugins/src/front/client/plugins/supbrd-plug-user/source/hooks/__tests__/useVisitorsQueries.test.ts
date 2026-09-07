import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { GetVisitorsParams } from "../../../../../../../../../supbrd-front-ui/src/shared/types/index.js";
import { renderHook, waitFor } from "../../../../../../../../../supbrd-front-ui/tests/render.js";
import { createTestQueryClient } from "../../../../supbrd-plugmod-dynamic-links/source/hooks/__tests__/query-test-utils.js";
import {
	useVisitorsQuery,
	useAggregatedVisitorsQuery,
	useVisitorDetailsQuery,
} from "../queries/useVisitorsQueries.js";

vi.mock("../../api/visitors/visitorsService.js", () => ({
	getVisitorsAPICall: vi.fn(),
	getAgregatedVisitorsAPICall: vi.fn(),
	getVisitorDetailsAPICall: vi.fn(),
}));

import {
	getVisitorsAPICall,
	getAgregatedVisitorsAPICall,
	getVisitorDetailsAPICall,
} from "../../api/visitors/visitorsService.js";

const mockedGetVisitors = vi.mocked(getVisitorsAPICall);
const mockedGetAggregated = vi.mocked(getAgregatedVisitorsAPICall);
const mockedGetDetails = vi.mocked(getVisitorDetailsAPICall);

function createWrapper(queryClient: QueryClient) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return createElement(QueryClientProvider, { client: queryClient }, children);
	};
}

describe("useVisitorsQueries", () => {
	let queryClient: QueryClient;

	beforeEach(() => {
		queryClient = createTestQueryClient();
		vi.clearAllMocks();
	});

	describe("useVisitorsQuery", () => {
		it("is disabled when projectId is undefined", () => {
			const { result } = renderHook(
				() =>
					useVisitorsQuery(undefined, {
						page: 1,
					} as unknown as GetVisitorsParams),
				{ wrapper: createWrapper(queryClient) },
			);
			expect(result.current.fetchStatus).toBe("idle");
		});

		it("is disabled when params is null", () => {
			const { result } = renderHook(() => useVisitorsQuery("proj-1", null), {
				wrapper: createWrapper(queryClient),
			});
			expect(result.current.fetchStatus).toBe("idle");
		});

		it("fetches and transforms visitors data", async () => {
			mockedGetVisitors.mockResolvedValueOnce({
				data: {
					visitors: [{ id: "v1" }],
					meta: { total_pages: 5, total_entries: 50 },
				},
			} as never);

			const { result } = renderHook(
				() =>
					useVisitorsQuery("proj-1", {
						page: 1,
					} as unknown as GetVisitorsParams),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(result.current.data).toEqual({
				visitors: [{ id: "v1" }],
				totalPages: 5,
				totalEntries: 50,
			});
		});
	});

	describe("useAggregatedVisitorsQuery", () => {
		it("is disabled when params is null", () => {
			const { result } = renderHook(() => useAggregatedVisitorsQuery("proj-1", null), {
				wrapper: createWrapper(queryClient),
			});
			expect(result.current.fetchStatus).toBe("idle");
		});

		it("fetches aggregated visitors", async () => {
			mockedGetAggregated.mockResolvedValueOnce({
				data: {
					visitors: [{ id: "av1", count: 10 }],
					meta: { total_pages: 2, total_entries: 20 },
				},
			} as never);

			const { result } = renderHook(
				() =>
					useAggregatedVisitorsQuery("proj-1", {
						period: "7d",
					} as unknown as GetVisitorsParams),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(result.current.data?.totalPages).toBe(2);
		});
	});

	describe("useVisitorDetailsQuery", () => {
		it("is disabled when projectId is undefined", () => {
			const { result } = renderHook(() => useVisitorDetailsQuery(undefined, "v1"), {
				wrapper: createWrapper(queryClient),
			});
			expect(result.current.fetchStatus).toBe("idle");
		});

		it("is disabled when visitorId is undefined", () => {
			const { result } = renderHook(() => useVisitorDetailsQuery("proj-1", undefined), {
				wrapper: createWrapper(queryClient),
			});
			expect(result.current.fetchStatus).toBe("idle");
		});

		it("fetches visitor details", async () => {
			const details = { id: "v1", name: "Visitor 1" };
			mockedGetDetails.mockResolvedValueOnce({ data: details } as never);

			const { result } = renderHook(() => useVisitorDetailsQuery("proj-1", "v1"), {
				wrapper: createWrapper(queryClient),
			});

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(result.current.data).toEqual(details);
		});
	});
});
