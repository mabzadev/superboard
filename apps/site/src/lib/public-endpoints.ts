import type { PublicEndpoints } from "@superboard/front-ui/context";

const services = new Set(["api", "auth", "sdk", "shortlinks", "files", "mcp", "site"]);
function isPublicService(value: string): value is keyof PublicEndpoints {
	return services.has(value);
}
export function parsePublicEndpoints(raw: string | undefined): PublicEndpoints {
	if (!raw) return {};
	try {
		const value: unknown = JSON.parse(raw);
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
		const endpoints: PublicEndpoints = {};
		for (const [key, origin] of Object.entries(value)) {
			if (!isPublicService(key) || typeof origin !== "string") throw new Error();
			const url = new URL(origin);
			if (
				url.protocol !== "https:" ||
				url.username ||
				url.password ||
				url.pathname !== "/" ||
				url.search ||
				url.hash
			)
				throw new Error();
			endpoints[key] = url.origin;
		}
		return endpoints;
	} catch {
		throw new Error("PUBLIC_ENDPOINTS_INVALID");
	}
}
