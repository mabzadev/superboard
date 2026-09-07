import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import * as hooks from "../mutations/useInstanceMutations.js";
const network = vi.hoisted(() => ({
	setIOSAppConfigAPICall: vi.fn(),
	setIOSPushConfigAPICall: vi.fn(),
	setIOSApiAccessKeyAPICall: vi.fn(),
	setAndroidAppConfigAPICall: vi.fn(),
	setAndroidPushConfigAPICall: vi.fn(),
	setAndroidAppWebhookAccessKeyAPICall: vi.fn(),
	setWebAppConfigAPICall: vi.fn(),
	setDesktopAppConfigAPICall: vi.fn(),
	removeIOSConfigAPICall: vi.fn(),
	removeAndroidConfigAPICall: vi.fn(),
	removeWebConfigAPICall: vi.fn(),
}));
vi.mock("../../api/applications/configApplicationsService.js", () => network);
function mutationCase<T>(
	name: string,
	hook: (id: string | undefined) => { mutateAsync(input: T): Promise<unknown> },
	data: T,
) {
	return {
		name,
		async verify(id: string | undefined) {
			const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
			const own = ["instances", "instance-a", "config"];
			const other = ["instances", "instance-b", "config"];
			client.setQueryData(own, { name: "Previous settings" });
			client.setQueryData(other, { name: "Other settings" });
			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(QueryClientProvider, { client }, children);
			const { result, unmount } = renderHook(() => hook(id), { wrapper });
			try {
				if (id) {
					await act(async () => {
						await result.current.mutateAsync(data);
					});
					expect(client.getQueryState(own)?.isInvalidated).toBe(true);
					expect(client.getQueryState(other)?.isInvalidated).toBe(false);
				} else {
					await act(async () => {
						await expect(result.current.mutateAsync(data)).rejects.toThrow(
							"Instance ID is required",
						);
					});
					expect(client.getQueryState(own)?.isInvalidated).toBe(false);
					expect(Object.values(network).every((call) => call.mock.calls.length === 0)).toBe(true);
				}
			} finally {
				unmount();
				client.clear();
			}
		},
	};
}
const upload = new FormData();
upload.set("enabled", "true");
const cases = [
	mutationCase("iOS settings", hooks.useSetIosConfigMutation, upload),
	mutationCase("iOS push", hooks.useSetIosPushConfigMutation, upload),
	mutationCase("iOS API key", hooks.useSetIosApiAccessKeyMutation, upload),
	mutationCase("Android settings", hooks.useSetAndroidConfigMutation, upload),
	mutationCase("Android push", hooks.useSetAndroidPushConfigMutation, upload),
	mutationCase("Android webhook", hooks.useSetAndroidWebhookKeyMutation, upload),
	mutationCase("Web domains", hooks.useSetWebConfigMutation, {
		enabled: true,
		domains: ["example.test"],
	}),
	mutationCase("Desktop settings", hooks.useSetDesktopConfigMutation, upload),
	mutationCase("remove iOS", hooks.useRemoveIosConfigMutation, undefined),
	mutationCase("remove Android", hooks.useRemoveAndroidConfigMutation, undefined),
	mutationCase("remove Web", hooks.useRemoveWebConfigMutation, undefined),
];
beforeEach(() => {
	for (const call of Object.values(network))
		call.mockReset().mockResolvedValue({ data: { saved: true } });
});
describe.each(cases)("$name", (entry) => {
	it("invalidates the changed instance settings without discarding another instance cache", () =>
		entry.verify("instance-a"));
	it("refuses a mutation without an instance and preserves the cache", () =>
		entry.verify(undefined));
});
