import { createRouteInventoryCollector } from "@superboard/contracts/route-inventory";
import { buildRouteManifest, withRouteManifest } from "@superboard/contracts/route-manifest";
import { createFetchRouter } from "@superboard/contracts/route-registry";
import { expect, test } from "vitest";

const secret = "inventory-internal-test";
const bindings = (build: string) => ({
	SUPERBOARD_INSTANCE_ID: "instance-a",
	ENVIRONMENT: "test",
	SUPERBOARD_RELEASE: "release-a",
	SUPERBOARD_WORKER_VERSION: { id: build },
	INTERNAL_API_TOKEN: secret,
	MODULE_INTERNAL_TOKEN: secret,
});
const make = (service: string, pluginId: string) =>
	createFetchRouter<Record<string, unknown>>({
		service,
		module: "fixture",
		pluginId,
		surface: "internal",
		access: "internal",
	});

test("aggregation follows executing services, new endpoints and independent owners in one Worker", async () => {
	const core = make("api", "supbrd-core"),
		app = make("app", "plugin-a"),
		billing = make("billing", "plugin-b");
	app.get("/first", () => Response.json({ owner: "a" }));
	billing.get("/second", () => Response.json({ owner: "b" }));
	const appEnv = bindings("app-version"),
		billingEnv = bindings("billing-version");
	const appWorker = withRouteManifest(app, [app], { service: "app", pluginId: "plugin-a" });
	const billingWorker = withRouteManifest(billing, [billing], {
		service: "billing",
		pluginId: "plugin-b",
	});
	let failBilling = false;
	const statuses: number[] = [];
	const sources = [
		{
			service: "app",
			workerName: "shared-worker",
			enabled: true,
			secret,
			binding: {
				fetch: async (request: Request) => {
					const response = await appWorker.fetch(request, appEnv);
					statuses.push(response.status);
					return response;
				},
			},
		},
		{
			service: "billing",
			workerName: "shared-worker",
			enabled: true,
			secret,
			binding: {
				fetch: (request: Request) => {
					if (failBilling) throw new Error("OFFLINE");
					return billingWorker.fetch(request, billingEnv);
				},
			},
		},
	];
	const own = await buildRouteManifest([core], bindings("api-version"), {
		service: "api",
		pluginId: "supbrd-core",
	});
	const collect = createRouteInventoryCollector();
	const input = { instanceId: "instance-a", environment: "test", own, sources };
	const first = await collect(input);
	expect(first.status).toBe("complete");
	expect(first.versions).toBe("consistent");
	expect(first.routes.find((route) => route.path === "/first")?.pluginId).toBe("plugin-a");
	expect(first.routes.find((route) => route.path === "/second")?.pluginId).toBe("plugin-b");
	const unchanged = await collect(input);
	expect(statuses).toEqual([200, 304]);
	expect(unchanged.revision).toBe(first.revision);
	app.get("/added", () => Response.json({ added: true }));
	expect(
		await (await appWorker.fetch(new Request("https://app.internal/added"), appEnv)).json(),
	).toEqual({ added: true });
	const added = await collect(input);
	expect(added.routes.some((route) => route.path === "/added")).toBe(true);
	expect(added.revision).not.toBe(first.revision);
	billingEnv.SUPERBOARD_RELEASE = "release-b";
	expect((await collect(input)).versions).toBe("mixed");
	failBilling = true;
	const partial = await collect(input);
	expect(partial.status).toBe("partial");
	expect(partial.sources.find((source) => source.service === "billing")?.status).toBe("stale");
	expect(partial.routes.find((route) => route.path === "/second")?.availability).toBe("stale");
	expect(partial.sources.find((source) => source.service === "app")?.status).toBe("current");
});

test("missing bindings stay unavailable and old observations never cross instances", async () => {
	const core = make("api", "supbrd-core");
	const own = await buildRouteManifest([core], bindings("api-version"), {
		service: "api",
		pluginId: "supbrd-core",
	});
	const result = await createRouteInventoryCollector()({
		instanceId: "instance-a",
		environment: "test",
		own,
		sources: [{ service: "app", workerName: "app", enabled: true }],
	});
	expect(result.status).toBe("partial");
	expect(result.sources.find((source) => source.service === "app")).toMatchObject({
		status: "unavailable",
		observedAt: null,
		buildId: null,
	});
	await expect(
		createRouteInventoryCollector()({
			instanceId: "other-instance",
			environment: "test",
			own,
			sources: [],
		}),
	).rejects.toThrow("ROUTE_RUNTIME_MISMATCH");
});
