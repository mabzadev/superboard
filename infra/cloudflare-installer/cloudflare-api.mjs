import { encodeBuildVariables } from "../../scripts/cloudflare/build-variables.mjs";

export function installerApi(token, fetchImpl = fetch) {
	return {
		async request(path, method = "GET", body) {
			if (method === "PATCH" && path.endsWith("/environment_variables"))
				body = await encodeBuildVariables(body);
			const multipart = body instanceof FormData;
			const response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					...(!multipart ? { "Content-Type": "application/json" } : {}),
				},
				...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
				signal: AbortSignal.timeout(30_000),
			});
			if (!response.ok) throw new Error(`CLOUDFLARE_API_${response.status}`);
			const payload = await response.json();
			if (!payload.success) throw new Error("CLOUDFLARE_API_FAILED");
			return payload;
		},
		async list(path) {
			const items = [];
			for (let page = 1; page <= 1000; page += 1) {
				const payload = await this.request(
					`${path}${path.includes("?") ? "&" : "?"}page=${page}&per_page=100`,
				);
				if (!Array.isArray(payload.result)) throw new Error("CLOUDFLARE_LIST_INVALID");
				items.push(...payload.result);
				if (
					payload.result_info?.total_pages != null
						? page >= payload.result_info.total_pages
						: payload.result.length < 100
				)
					return items;
			}
			throw new Error("CLOUDFLARE_PAGINATION_LIMIT");
		},
	};
}
