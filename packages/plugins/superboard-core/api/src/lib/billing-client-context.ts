export type BillingClientContext = {
	country?: string;
	language?: string;
	platform?: string;
	app_version?: string;
	sdk_version?: string;
	storefront?: string;
};

export function parseBillingClientContext(value: unknown): BillingClientContext {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const record = Object.fromEntries(Object.entries(value));
	const result: BillingClientContext = {};
	for (const key of [
		"country",
		"language",
		"platform",
		"app_version",
		"sdk_version",
		"storefront",
	] as const) {
		const text = typeof record[key] === "string" ? record[key].trim() : "";
		if (
			!text ||
			text.length > 80 ||
			[...text].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
		)
			continue;
		if (key === "country" && !/^[A-Z]{2}$/.test(text)) continue;
		if (key === "language" && !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(text)) continue;
		if (key === "platform" && !["ios", "android", "web", "desktop"].includes(text)) continue;
		result[key] = text;
	}
	return result;
}

export function billingClientContextFromRequest(request: Request): BillingClientContext {
	const edge = request as Request & { cf?: { country?: string } };
	return parseBillingClientContext({
		country: edge.cf?.country ?? request.headers.get("CF-IPCountry"),
		language:
			request.headers.get("X-SuperBoard-Language") ??
			request.headers.get("Accept-Language")?.split(",")[0]?.split(";")[0],
		platform: request.headers.get("PLATFORM"),
		app_version: request.headers.get("X-SuperBoard-App-Version"),
		sdk_version: request.headers.get("X-SuperBoard-SDK-Version"),
		storefront: request.headers.get("X-SuperBoard-Storefront"),
	});
}
