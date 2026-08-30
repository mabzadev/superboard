interface OperatorApiProxyEnv {
	API_SERVICE?: { fetch(request: Request): Promise<Response> };
	MODULE_INTERNAL_TOKEN?: string;
}

export async function proxyOperatorApiRequest(input: {
	request: Request;
	operator_email: string;
	env: OperatorApiProxyEnv;
}): Promise<Response> {
	const email = input.operator_email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
		return errorResponse(401, "OPERATOR_IDENTITY_INVALID");
	}
	const token = input.env.MODULE_INTERNAL_TOKEN?.trim();
	if (!input.env.API_SERVICE || !token) {
		return errorResponse(503, "GATEWAY_BRIDGE_UNAVAILABLE");
	}
	const source = new URL(input.request.url);
	if (!["GET", "HEAD", "OPTIONS"].includes(input.request.method)) {
		const origin = input.request.headers.get("Origin");
		if (!origin || origin !== source.origin)
			return errorResponse(403, "CROSS_ORIGIN_MUTATION_REJECTED");
	}
	const target = new URL(`${source.pathname}${source.search}`, "https://api.internal");
	const headers = new Headers(input.request.headers);
	for (const name of [
		"authorization",
		"cookie",
		"host",
		"x-superboard-site-operator",
		"x-superboard-internal-token",
	]) {
		headers.delete(name);
	}
	headers.set("X-SuperBoard-Site-Operator", email);
	headers.set("X-SuperBoard-Internal-Token", token);
	headers.set("X-Request-Id", headers.get("X-Request-Id")?.trim() || crypto.randomUUID());
	const forwarded = new Request(new Request(target, input.request), { headers });
	const response = await input.env.API_SERVICE.fetch(forwarded);
	const responseHeaders = new Headers(response.headers);
	responseHeaders.delete("Set-Cookie");
	responseHeaders.set("Cache-Control", "private, no-store");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: responseHeaders,
	});
}

function errorResponse(status: number, code: string) {
	return Response.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store" } });
}
