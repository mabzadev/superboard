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

export function resolveSiteReleaseOperations({
	requested,
	service,
	environment,
	sitePreviewRoute,
	publicRoutesEnabled = false,
	readOnly = false,
}) {
	if (readOnly && requested)
		throw new Error("--read-only-console conflicts with --release-operations");
	const operationalConsole = service === "site" && publicRoutesEnabled && !readOnly;
	if (!requested && !operationalConsole) return { value: "disabled", cliArgs: [] };
	if (
		service !== "site" ||
		(!operationalConsole &&
			environment !== "local" &&
			(environment !== "development" || !sitePreviewRoute))
	) {
		throw new Error(
			"--release-operations requires a local Site or an active development Site preview route",
		);
	}
	return { value: "enabled", cliArgs: ["--release-operations"] };
}
