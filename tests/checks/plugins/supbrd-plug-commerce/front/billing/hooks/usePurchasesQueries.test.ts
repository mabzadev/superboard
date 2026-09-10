import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
	useProjectPurchasesQuery,
	useRevenueMetricsQuery,
} from "../../../../../../../packages/plugins/supbrd-plug-commerce/src/front/billing/hooks/queries/usePurchasesQueries.js";
import type { GetRevenueParams } from "../../../../../../../packages/supbrd-front-ui/src/shared/types/index.js";
import { renderHook, waitFor } from "../../../../../packages/supbrd-front-ui/render.js";
import { createTestQueryClient } from "../../../../supbrd-plug-communication/front/dynamic-links/hooks/query-test-utils.js";

vi.mock(
	"../../../../../../../packages/plugins/supbrd-plug-commerce/src/front/billing/api/purchases/purchasesService.js",
	() => ({
		getProjectPurchasesAPICall: vi.fn(),
		getRevenueMetricsAPICall: vi.fn(),
	}),
);

import {
	getProjectPurchasesAPICall,
	getRevenueMetricsAPICall,
} from "../../../../../../../packages/plugins/supbrd-plug-commerce/src/front/billing/api/purchases/purchasesService.js";

const mockedGetPurchases = vi.mocked(getProjectPurchasesAPICall);
const mockedGetRevenue = vi.mocked(getRevenueMetricsAPICall);

function createWrapper(queryClient: QueryClient) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return createElement(QueryClientProvider, { client: queryClient }, children);
	};
}

describe("usePurchasesQueries", () => {
	let queryClient: QueryClient;

	beforeEach(() => {
		queryClient = createTestQueryClient();
		vi.clearAllMocks();
	});

	describe("useProjectPurchasesQuery", () => {
		it("is disabled when projectId is undefined", () => {
			const { result } = renderHook(
				() =>
					useProjectPurchasesQuery(undefined, {
						page: 1,
					} as unknown as GetRevenueParams),
				{ wrapper: createWrapper(queryClient) },
			);
			expect(result.current.fetchStatus).toBe("idle");
		});

		it("is disabled when params is null", () => {
			const { result } = renderHook(() => useProjectPurchasesQuery("proj-1", null), {
				wrapper: createWrapper(queryClient),
			});
			expect(result.current.fetchStatus).toBe("idle");
		});

		it("fetches and transforms purchases data", async () => {
			mockedGetPurchases.mockResolvedValueOnce({
				data: {
					data: [{ id: "p1", amount: 9.99 }],
					total_pages: 2,
				},
			} as never);

			const { result } = renderHook(
				() =>
					useProjectPurchasesQuery("proj-1", {
						page: 1,
					} as unknown as GetRevenueParams),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(result.current.data).toEqual({
				data: [{ id: "p1", amount: 9.99 }],
				totalPages: 2,
			});
		});
	});

	describe("useRevenueMetricsQuery", () => {
		it("is disabled when projectId is undefined", () => {
			const { result } = renderHook(
				() =>
					useRevenueMetricsQuery(undefined, {
						period: "30d",
					} as unknown as GetRevenueParams),
				{ wrapper: createWrapper(queryClient) },
			);
			expect(result.current.fetchStatus).toBe("idle");
		});

		it("fetches revenue metrics", async () => {
			mockedGetRevenue.mockResolvedValueOnce({
				data: {
					data: [{ metric: "revenue", value: 1000 }],
					total_pages: 1,
				},
			} as never);

			const { result } = renderHook(
				() =>
					useRevenueMetricsQuery("proj-1", {
						period: "30d",
					} as unknown as GetRevenueParams),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(result.current.data).toEqual({
				data: [{ metric: "revenue", value: 1000 }],
				totalPages: 1,
				totalEntries: 10,
			});
		});
	});
});
