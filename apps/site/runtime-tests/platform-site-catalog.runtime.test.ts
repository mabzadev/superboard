import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import { buildPlatformStatus } from "../../../workers/api/src/routes/platform-status.js";
import catalogFixture from "./fixtures/platform-site-catalog.generated.json";
import { pluginDatabase, prepareApiPlugin } from "./retirement-api-helpers.js";

test("the current generated target catalog accepts Site health without a Dashboard Worker or invented Site storage metrics", async () => {
	const scope = await prepareApiPlugin("supbrd-plugmod-observability");
	const result = await buildPlatformStatus(
		{
			...env,
			DB: pluginDatabase("api"),
			ENVIRONMENT: catalogFixture.environment,
			SUPERBOARD_TARGET: catalogFixture.target,
			PLATFORM_WORKERS_JSON: JSON.stringify(catalogFixture.catalog),
			PUBLIC_SURFACES_JSON: undefined,
			SITE_SERVICE: SELF,
			PUBLIC_ROUTING_MODE: "active",
		} as never,
		{ instanceId: scope.instance.id },
	);
	expect(result.catalog).toMatchObject({
		status: "ok",
		target: catalogFixture.target,
		environment: catalogFixture.environment,
	});
	const site = result.services.find((service) => service.id === "site");
	expect(site).toMatchObject({
		status: "ok",
		enabled: true,
		workerName: catalogFixture.catalog.workers.find((worker) => worker.id === "site")!.workerName,
		health: { mode: "binding", path: "/superboard-system/health" },
		jobs: null,
	});
	expect(result.services.some((service) => service.id === "dashboard")).toBe(false);
	expect(
		result.dataStores.some(
			(store) => store.id === "dashboard-cache" || store.owner === "dashboard",
		),
	).toBe(false);
	const siteStores = result.dataStores.filter((store) => store.owner === "site");
	expect(siteStores.map((store) => store.id).toSorted()).toEqual(
		["site", "site-media", "site-release-cache", "site-sessions"].toSorted(),
	);
	expect(siteStores.every((store) => store.status === "unavailable")).toBe(true);
	expect(siteStores.find((store) => store.kind === "D1")).toMatchObject({ schema: null });
	expect(result.metrics.users).toBeNull();
	const missing = await buildPlatformStatus(
		{
			...env,
			DB: pluginDatabase("api"),
			ENVIRONMENT: catalogFixture.environment,
			SUPERBOARD_TARGET: catalogFixture.target,
			PLATFORM_WORKERS_JSON: JSON.stringify(catalogFixture.catalog),
			PUBLIC_SURFACES_JSON: undefined,
			SITE_SERVICE: undefined,
		} as never,
		{ instanceId: scope.instance.id },
	);
	expect(missing.catalog.status).toBe("ok");
	expect(missing.services.find((service) => service.id === "site")).toMatchObject({
		status: "misconfigured",
		jobs: null,
	});
	expect(
		missing.dataStores
			.filter((store) => store.owner === "site")
			.every((store) => store.status === "misconfigured"),
	).toBe(true);
});
