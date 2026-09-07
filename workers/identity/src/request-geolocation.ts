export function requestGeolocation(request: { cf?: unknown }): string | null {
	if (!request.cf || typeof request.cf !== "object") return null;
	const cf = request.cf as Record<string, unknown>;
	return JSON.stringify({
		longitude: cf.longitude,
		continent: cf.continent,
		country: cf.country,
		timezone: cf.timezone,
		region: cf.region,
		regionCode: cf.regionCode,
		latitude: cf.latitude,
	});
}
