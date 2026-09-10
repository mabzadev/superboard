import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
	useSetDefaultRedirectMutation,
	useSetRedirectMutation,
	useSetSubdomainMutation,
	useSetGoogleTrackingIDMutation,
	useVerifySubdomainMutation,
} from "../../../../../../../packages/plugins/supbrd-plug-communication/src/front/dynamic-links/hooks/mutations/useConfigurationMutations.js";
import { renderHook, act } from "../../../../../packages/supbrd-front-ui/render.js";
import { createTestQueryClient } from "./query-test-utils.js";

vi.mock(
	"../../../../../../../packages/plugins/supbrd-plug-analytics/src/front/api/configurations/redirect/configRedirectService.js",
	() => ({
		setDefaultRedirectAPICall: vi.fn(),
		setRedirectAPICall: vi.fn(),
	}),
);

vi.mock(
	"../../../../../../../packages/plugins/supbrd-plug-analytics/src/front/api/configurations/domains/configDomainsService.js",
	() => ({
		setSubdomainAPICall: vi.fn(),
		setGoogleTrackingIDAPICall: vi.fn(),
		verifySubdomainAvailabilityAPICall: vi.fn(),
	}),
);

vi.mock(
	"../../../../../../../packages/plugins/supbrd-core/src/front/settings/analytics/index.js",
	() => ({
		trackEvent: vi.fn(),
		EVENTS: {
			REDIRECT_RULES_CREATED: "redirect_rules_created",
		},
	}),
);

import { trackEvent } from "../../../../../../../packages/plugins/supbrd-core/src/front/settings/analytics/index.js";
import {
	setSubdomainAPICall,
	setGoogleTrackingIDAPICall,
	verifySubdomainAvailabilityAPICall,
} from "../../../../../../../packages/plugins/supbrd-plug-analytics/src/front/api/configurations/domains/configDomainsService.js";
import {
	setDefaultRedirectAPICall,
	setRedirectAPICall,
} from "../../../../../../../packages/plugins/supbrd-plug-analytics/src/front/api/configurations/redirect/configRedirectService.js";
import type { GoogleTrackingIdPayload } from "../../../../../../../packages/supbrd-front-ui/src/shared/types/index.js";

const mockedSetDefaultRedirect = vi.mocked(setDefaultRedirectAPICall);
const mockedSetRedirect = vi.mocked(setRedirectAPICall);
const mockedSetSubdomain = vi.mocked(setSubdomainAPICall);
const mockedSetGoogleTrackingID = vi.mocked(setGoogleTrackingIDAPICall);
const mockedVerifySubdomain = vi.mocked(verifySubdomainAvailabilityAPICall);
const mockedTrackEvent = vi.mocked(trackEvent);

function createWrapper(queryClient: QueryClient) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return createElement(QueryClientProvider, { client: queryClient }, children);
	};
}

describe("useConfigurationMutations", () => {
	let queryClient: QueryClient;

	beforeEach(() => {
		queryClient = createTestQueryClient();
		vi.clearAllMocks();
	});

	describe("useSetDefaultRedirectMutation", () => {
		it("calls setDefaultRedirectAPICall with correct arguments", async () => {
			mockedSetDefaultRedirect.mockResolvedValueOnce({ data: {} } as never);

			const { result } = renderHook(() => useSetDefaultRedirectMutation("proj-1"), {
				wrapper: createWrapper(queryClient),
			});

			await act(async () => {
				await result.current.mutateAsync({
					defaultFallback: "https://example.com",
					showAndroidPreview: true,
					showIosPreview: false,
				});
			});

			expect(mockedSetDefaultRedirect).toHaveBeenCalledWith(
				"proj-1",
				"https://example.com",
				true,
				false,
			);
		});

		it("tracks event on success without invalidating queries", async () => {
			mockedSetDefaultRedirect.mockResolvedValueOnce({ data: {} } as never);
			const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

			const { result } = renderHook(() => useSetDefaultRedirectMutation("proj-1"), {
				wrapper: createWrapper(queryClient),
			});

			await act(async () => {
				await result.current.mutateAsync({
					defaultFallback: "https://example.com",
					showAndroidPreview: false,
					showIosPreview: false,
				});
			});

			expect(mockedTrackEvent).toHaveBeenCalledWith("redirect_rules_created", {
				projectId: "proj-1",
			});
			// Invalidation is handled by the caller (handleSaveAll) to avoid race conditions
			expect(invalidateSpy).not.toHaveBeenCalled();
		});
	});

	describe("useSetRedirectMutation", () => {
		it("calls setRedirectAPICall with correct arguments", async () => {
			mockedSetRedirect.mockResolvedValueOnce({ data: {} } as never);

			const { result } = renderHook(() => useSetRedirectMutation("proj-1"), {
				wrapper: createWrapper(queryClient),
			});

			await act(async () => {
				await result.current.mutateAsync({
					platform: "ios",
					variation: "phone",
					appstore: true,
					fallbackUrl: "https://fallback.com",
					enabled: true,
				});
			});

			expect(mockedSetRedirect).toHaveBeenCalledWith(
				"proj-1",
				"ios",
				"phone",
				true,
				"https://fallback.com",
				true,
			);
		});

		it("does not invalidate queries (handled by caller)", async () => {
			mockedSetRedirect.mockResolvedValueOnce({ data: {} } as never);
			const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

			const { result } = renderHook(() => useSetRedirectMutation("proj-1"), {
				wrapper: createWrapper(queryClient),
			});

			await act(async () => {
				await result.current.mutateAsync({
					platform: "android",
					variation: "phone",
					appstore: false,
					fallbackUrl: null,
					enabled: false,
				});
			});

			// Invalidation is handled by the caller (handleSaveAll) to avoid race conditions
			expect(invalidateSpy).not.toHaveBeenCalled();
		});
	});

	describe("useSetSubdomainMutation", () => {
		it("calls setSubdomainAPICall with projectId and formData", async () => {
			mockedSetSubdomain.mockResolvedValueOnce({ data: {} } as never);

			const { result } = renderHook(() => useSetSubdomainMutation("proj-1"), {
				wrapper: createWrapper(queryClient),
			});

			const formData = { subdomain: "my-app" };
			await act(async () => {
				await result.current.mutateAsync(formData);
			});

			expect(mockedSetSubdomain).toHaveBeenCalledWith("proj-1", formData);
		});

		it("invalidates domain config on success", async () => {
			mockedSetSubdomain.mockResolvedValueOnce({ data: {} } as never);
			const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

			const { result } = renderHook(() => useSetSubdomainMutation("proj-1"), {
				wrapper: createWrapper(queryClient),
			});

			await act(async () => {
				await result.current.mutateAsync({ subdomain: "test" });
			});

			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: ["projects", "proj-1", "domainConfig"],
			});
		});

		it("does not invalidate when projectId is undefined", async () => {
			const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

			const { result } = renderHook(() => useSetSubdomainMutation(undefined), {
				wrapper: createWrapper(queryClient),
			});

			await act(async () => {
				await result.current.mutateAsync({ subdomain: "test" }).catch(() => {});
			});

			expect(invalidateSpy).not.toHaveBeenCalled();
		});
	});

	describe("useSetGoogleTrackingIDMutation", () => {
		it("calls setGoogleTrackingIDAPICall with projectId and formData", async () => {
			mockedSetGoogleTrackingID.mockResolvedValueOnce({ data: {} } as never);

			const { result } = renderHook(() => useSetGoogleTrackingIDMutation("proj-1"), {
				wrapper: createWrapper(queryClient),
			});

			const formData = {
				tracking_id: "G-12345",
			} as unknown as GoogleTrackingIdPayload;
			await act(async () => {
				await result.current.mutateAsync(formData);
			});

			expect(mockedSetGoogleTrackingID).toHaveBeenCalledWith("proj-1", formData);
		});

		it("invalidates domain config on success", async () => {
			mockedSetGoogleTrackingID.mockResolvedValueOnce({ data: {} } as never);
			const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

			const { result } = renderHook(() => useSetGoogleTrackingIDMutation("proj-1"), {
				wrapper: createWrapper(queryClient),
			});

			await act(async () => {
				await result.current.mutateAsync({
					tracking_id: "G-12345",
				} as unknown as GoogleTrackingIdPayload);
			});

			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: ["projects", "proj-1", "domainConfig"],
			});
		});

		it("does not invalidate when projectId is undefined", async () => {
			const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

			const { result } = renderHook(() => useSetGoogleTrackingIDMutation(undefined), {
				wrapper: createWrapper(queryClient),
			});

			await act(async () => {
				await result.current
					.mutateAsync({
						tracking_id: "G-12345",
					} as unknown as GoogleTrackingIdPayload)
					.catch(() => {});
			});

			expect(invalidateSpy).not.toHaveBeenCalled();
		});
	});

	describe("useVerifySubdomainMutation", () => {
		it("calls verifySubdomainAvailabilityAPICall with projectId and subdomain", async () => {
			mockedVerifySubdomain.mockResolvedValueOnce({
				data: { available: true },
			} as never);

			const { result } = renderHook(() => useVerifySubdomainMutation("proj-1"), {
				wrapper: createWrapper(queryClient),
			});

			await act(async () => {
				await result.current.mutateAsync("my-subdomain");
			});

			expect(mockedVerifySubdomain).toHaveBeenCalledWith("proj-1", "my-subdomain");
		});

		it("does not invalidate any queries (no onSuccess handler)", async () => {
			mockedVerifySubdomain.mockResolvedValueOnce({
				data: { available: true },
			} as never);
			const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

			const { result } = renderHook(() => useVerifySubdomainMutation("proj-1"), {
				wrapper: createWrapper(queryClient),
			});

			await act(async () => {
				await result.current.mutateAsync("test-sub");
			});

			expect(invalidateSpy).not.toHaveBeenCalled();
		});
	});
});
