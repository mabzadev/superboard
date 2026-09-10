import { renderHook, act } from "@testing-library/react";
import * as React from "react";
import { expect, test, vi } from "vitest";

import { routeConfig } from "../../../../../../../../../packages/plugins/supbrd-plug-identity/worker/src/melody/configs";
import { bannerModel } from "../../../../../../../../../packages/plugins/supbrd-plug-identity/worker/src/melody/models";
import useAppBanners from "../../../../../../../../../packages/plugins/supbrd-plug-identity/worker/src/melody/pages/hooks/useAppBanners";
import { InitialProps } from "../../../../../../../../../packages/plugins/supbrd-plug-identity/worker/src/melody/pages/hooks/useInitialProps";
import { AuthorizeParams } from "../../../../../../../../../packages/plugins/supbrd-plug-identity/worker/src/melody/pages/tools/param";
import * as requestModule from "../../../../../../../../../packages/plugins/supbrd-plug-identity/worker/src/melody/pages/tools/request";

// Mock hooks from hono/jsx.
vi.mock("hono/jsx", () => ({
	useCallback: React.useCallback,
	useState: React.useState,
	useEffect: React.useEffect,
}));

// Dummy parameters to pass to the hook.
const dummyInitialProps = { enableAppBanner: true } as InitialProps;
const dummyParams = { clientId: "test-client-id" } as AuthorizeParams;

const createMockBanner = (id: number, text: string): bannerModel.Record =>
	({
		id,
		text,
		type: "info",
		isActive: true,
		locales: [],
		createdAt: "2023-01-01T00:00:00Z",
		updatedAt: "2023-01-01T00:00:00Z",
		deletedAt: null,
	}) as bannerModel.Record;

test("returns initial state correctly", () => {
	const { result } = renderHook(() =>
		useAppBanners({
			initialProps: dummyInitialProps,
			params: dummyParams,
		}),
	);

	expect(result.current.appBanners).toEqual([]);
});

test("fetchAppBanners fetches and sets app banners successfully", async () => {
	const mockBanners = [
		createMockBanner(1, "Welcome Banner"),
		createMockBanner(2, "Maintenance Notice"),
	];

	const fakeResponse = {
		ok: true,
		json: async () => ({ banners: mockBanners }),
	};
	const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(fakeResponse as Response);

	// Spy on parseResponse to ensure it's called
	const parseResponseSpy = vi
		.spyOn(requestModule, "parseResponse")
		.mockResolvedValue({ banners: mockBanners });

	const { result } = renderHook(() =>
		useAppBanners({
			initialProps: dummyInitialProps,
			params: dummyParams,
		}),
	);

	// Wait for useEffect to complete
	await act(async () => {
		await Promise.resolve();
	});

	// Verify fetch was called with correct URL and options
	expect(fetchSpy).toHaveBeenCalledWith(
		`${routeConfig.IdentityRoute.AppBanners}?client_id=${dummyParams.clientId}`,
		expect.objectContaining({
			method: "GET",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
		}),
	);

	// Verify parseResponse was called
	expect(parseResponseSpy).toHaveBeenCalledWith(fakeResponse);

	// Verify appBanners were set
	expect(result.current.appBanners).toEqual(mockBanners);

	// Cleanup
	fetchSpy.mockRestore();
	parseResponseSpy.mockRestore();
});

test("fetchAppBanners does not fetch when enableAppBanner is false", () => {
	const fetchSpy = vi.spyOn(global, "fetch");

	const initialPropsWithDisabledBanner = {
		...dummyInitialProps,
		enableAppBanner: false,
	} as InitialProps;

	renderHook(() =>
		useAppBanners({
			initialProps: initialPropsWithDisabledBanner,
			params: dummyParams,
		}),
	);

	// Verify fetch was not called
	expect(fetchSpy).not.toHaveBeenCalled();

	// Cleanup
	fetchSpy.mockRestore();
});
