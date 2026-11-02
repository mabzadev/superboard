const COOKIE_NAME_VALUE_PATTERN = /^([^;]+)/;

export type Interceptor = (
	request: Request,
	next: (request: Request) => Promise<Response>,
) => Promise<Response>;

export interface TransportOptions {
	interceptors?: Interceptor[];
}

function baseFetch(request: Request): Promise<Response> {
	return globalThis.fetch(request);
}

export function createTransport(options: TransportOptions = {}): {
	fetch: (request: Request) => Promise<Response>;
} {
	const interceptors = options.interceptors ?? [];

	let chain: (request: Request) => Promise<Response> = baseFetch;
	for (let i = interceptors.length - 1; i >= 0; i--) {
		const interceptor = interceptors[i];
		const next = chain;
		chain = (req) => interceptor(req, next);
	}

	return { fetch: chain };
}

export function csrfInterceptor(): Interceptor {
	const MUTATION_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

	return (request, next) => {
		if (MUTATION_METHODS.has(request.method)) {
			const headers = new Headers(request.headers);
			headers.set("X-EmDash-Request", "1");
			if (!headers.has("Origin")) {
				const url = new URL(request.url);
				headers.set("Origin", url.origin);
			}
			return next(new Request(request, { headers }));
		}
		return next(request);
	};
}

export function tokenInterceptor(token: string): Interceptor {
	return (request, next) => {
		const headers = new Headers(request.headers);
		headers.set("Authorization", `Bearer ${token}`);
		return next(new Request(request, { headers }));
	};
}

export function devBypassInterceptor(baseUrl: string): Interceptor {
	let sessionCookie: string | null = null;
	let initializing: Promise<void> | null = null;

	async function init(): Promise<void> {
		const bypassUrl = new URL("/_emdash/api/auth/dev-bypass", baseUrl);
		const res = await globalThis.fetch(bypassUrl, { redirect: "manual" });

		const setCookie = res.headers.get("set-cookie");
		if (setCookie) {
			const match = setCookie.match(COOKIE_NAME_VALUE_PATTERN);
			if (match) {
				sessionCookie = match[1]!;
			}
		}

		if (res.body) {
			await res.text().catch(() => {});
		}
	}

	return async (request, next) => {
		if (!sessionCookie) {
			if (!initializing) {
				initializing = init();
			}
			await initializing;
		}

		if (sessionCookie) {
			const headers = new Headers(request.headers);
			const existing = headers.get("cookie");
			headers.set("cookie", existing ? `${existing}; ${sessionCookie}` : sessionCookie);
			return next(new Request(request, { headers }));
		}

		return next(request);
	};
}

export function refreshInterceptor(options: {
	refreshToken: string;
	tokenEndpoint: string;
	onTokenRefreshed?: (accessToken: string, refreshToken: string, expiresAt: string) => void;
}): Interceptor {
	let refreshing: Promise<string | null> | null = null;

	async function refresh(): Promise<string | null> {
		const res = await globalThis.fetch(options.tokenEndpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "refresh_token",
				refresh_token: options.refreshToken,
			}),
		});

		if (!res.ok) return null;

		interface TokenFields {
			access_token: string;
			refresh_token?: string;
			expires_in?: number;
		}

		const json = (await res.json()) as Record<string, unknown>;

		const tokenData: TokenFields =
			json.data && typeof json.data === "object" && "access_token" in json.data
				? (json.data as TokenFields)
				: (json as unknown as TokenFields);

		const expiresAt = tokenData.expires_in
			? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
			: new Date(Date.now() + 3600_000).toISOString();

		if (options.onTokenRefreshed) {
			options.onTokenRefreshed(
				tokenData.access_token,
				tokenData.refresh_token ?? options.refreshToken,
				expiresAt,
			);
		}

		return tokenData.access_token;
	}

	return async (request, next) => {
		const retryTemplate = request.body ? request.clone() : request;

		const response = await next(request);

		if (response.status === 401) {
			if (!refreshing) {
				refreshing = refresh().finally(() => {
					refreshing = null;
				});
			}

			const newToken = await refreshing;
			if (newToken) {
				const headers = new Headers(retryTemplate.headers);
				headers.set("Authorization", `Bearer ${newToken}`);
				return next(new Request(retryTemplate, { headers }));
			}
		}

		return response;
	};
}
