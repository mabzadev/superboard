import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useLiveQuery } from "../../../../../packages/supbrd-front-ui/src/live-query.js";

function View() {
	const query = useLiveQuery({
		key: ["test-inventory"],
		url: "/inventory",
		parse: async (response) => {
			if (!response.ok) throw new Error("unavailable");
			return response.text();
		},
	});
	return (
		<div>
			{query.data ?? "loading"}
			{query.error ? " stale" : ""}
		</div>
	);
}
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

it("shares requests, reuses conditional responses, pauses hidden polling and refreshes on return", async () => {
	vi.useFakeTimers();
	let visible = true;
	vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
		visible ? "visible" : "hidden",
	);
	let value = "first";
	const requests: Headers[] = [];
	vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
		const headers = new Headers(init.headers);
		requests.push(headers);
		return headers.get("if-none-match") === value
			? new Response(null, { status: 304 })
			: new Response(value, { headers: { etag: value } });
	});
	const client = new QueryClient();
	render(
		<QueryClientProvider client={client}>
			<View />
			<View />
		</QueryClientProvider>,
	);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(10);
	});
	expect(screen.getAllByText("first")).toHaveLength(2);
	expect(requests).toHaveLength(1);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(30000);
	});
	expect(requests).toHaveLength(2);
	expect(requests[1]?.get("if-none-match")).toBe("first");
	await act(async () => {
		visible = false;
		document.dispatchEvent(new Event("visibilitychange"));
	});
	value = "second";
	await act(async () => {
		await vi.advanceTimersByTimeAsync(90000);
	});
	expect(requests).toHaveLength(2);
	await act(async () => {
		visible = true;
		document.dispatchEvent(new Event("visibilitychange"));
		await vi.advanceTimersByTimeAsync(10);
	});
	expect(screen.getAllByText("second")).toHaveLength(2);
	expect(requests).toHaveLength(3);
	client.clear();
});

it("keeps a failed observation visible but removes it when operator access is revoked", async () => {
	vi.useFakeTimers();
	let status = 200;
	vi.stubGlobal("fetch", async () => new Response("observed", { status }));
	const client = new QueryClient();
	render(
		<QueryClientProvider client={client}>
			<View />
		</QueryClientProvider>,
	);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(10);
	});
	expect(screen.getByText("observed")).toBeTruthy();
	status = 503;
	await act(async () => {
		await vi.advanceTimersByTimeAsync(30000);
	});
	expect(screen.getByText("observed stale")).toBeTruthy();
	status = 403;
	await act(async () => {
		await vi.advanceTimersByTimeAsync(30000);
	});
	expect(screen.queryByText("observed stale")).toBeNull();
	expect(screen.getByText("loading stale")).toBeTruthy();
	client.clear();
});
