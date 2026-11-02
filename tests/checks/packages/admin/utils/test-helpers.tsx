import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import { ThemeProvider } from "../../../../../packages/admin/src/components/ThemeProvider";

const HTTP_METHOD_PREFIX_REGEX = /^(GET|POST|PUT|DELETE|PATCH|ANY) /;

export function createTestQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: 0,
			},
			mutations: {
				retry: false,
			},
		},
	});
}

export function TestWrapper({ children }: { children: React.ReactNode }) {
	const queryClient = React.useMemo(() => createTestQueryClient(), []);
	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider defaultTheme="light">{children}</ThemeProvider>
		</QueryClientProvider>
	);
}

export function QueryWrapper({ children }: { children: React.ReactNode }) {
	const queryClient = React.useMemo(() => createTestQueryClient(), []);
	return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function createMockFetch() {
	const originalFetch = globalThis.fetch;
	const handlers = new Map<string, { status: number; body: unknown }>();

	function mockFetchFn(input: string | URL | Request, init?: RequestInit): Promise<Response> {
		const url =
			typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		const method = init?.method ?? "GET";
		const key = `${method.toUpperCase()} ${url}`;

		let handler = handlers.get(key);

		if (!handler) {
			handler = handlers.get(`ANY ${url}`);
		}

		if (!handler) {
			for (const [pattern, h] of handlers) {
				const patternUrl = pattern.replace(HTTP_METHOD_PREFIX_REGEX, "");
				if (url.startsWith(patternUrl)) {
					handler = h;
					break;
				}
			}
		}

		if (handler) {
			return Promise.resolve(
				new Response(JSON.stringify(handler.body), {
					status: handler.status,
					headers: { "Content-Type": "application/json" },
				}),
			);
		}

		return originalFetch(input, init);
	}

	globalThis.fetch = mockFetchFn as typeof fetch;

	return {
		on(method: string, url: string, body: unknown, status = 200) {
			handlers.set(`${method.toUpperCase()} ${url}`, { status, body });
			return this;
		},
		restore() {
			globalThis.fetch = originalFetch;
		},
		clear() {
			handlers.clear();
		},
	};
}

export async function waitFor(fn: () => boolean | void, timeout = 2000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		try {
			const result = fn();
			if (result !== false) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 50));
	}
	fn();
}
