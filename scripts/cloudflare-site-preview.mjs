export function resolveSitePreviewRoute({
	requested,
	service,
	environment,
	hostname,
	noRoutes = false,
	preflight = false,
}) {
	if (!requested) return null;
	if (
		service !== "site" ||
		environment !== "development" ||
		noRoutes ||
		preflight ||
		typeof hostname !== "string" ||
		!hostname
	) {
		throw new Error(
			"--site-preview-route is allowed only for an active development Site deployment",
		);
	}
	return {
		hostname,
		routes: [{ pattern: hostname, custom_domain: true }],
		cliArgs: ["--site-preview-route"],
	};
}
