import type { DeploymentConfiguration } from "@superboard/contracts/deployment-configuration";
import { Hono } from "hono";
import { expect, test } from "vitest";

import {
	deploymentRoutes,
	deploymentWebOrigins,
} from "../../../../../../../packages/plugins/supbrd-core/api/src/lib/deployment-routes.js";

test("newly registered SDK routes appear automatically without exposing handlers", () => {
	const config: DeploymentConfiguration = {
		schemaVersion: 1,
		target: "example",
		environment: "test",
		profile: "consolidated",
		source: "manifest",
		checksum: "checksum",
		publicRouting: "staged",
		workers: [],
		aliases: [],
		webOrigins: [],
		customCapabilities: [],
		authIssuer: "https://auth.example.test",
		endpoints: [
			{
				surface: "sdk",
				url: "https://sdk.example.test",
				worker: "api",
				clients: ["mobile", "web"],
			},
		],
	};
	const app = new Hono();
	app.get("/new-mobile-or-web-route", (c) => c.text("private-handler-content"));
	const routes = deploymentRoutes([], config, app.routes);
	expect(routes).toEqual([
		{
			method: "GET",
			path: "/new-mobile-or-web-route",
			surface: "sdk",
			url: "https://sdk.example.test/new-mobile-or-web-route",
			worker: "api",
			clients: ["mobile", "web"],
		},
	]);
	expect(JSON.stringify(routes)).not.toContain("private-handler-content");
});

test("configuration reporting rejects credentials and paths in web origins", () => {
	expect(
		deploymentWebOrigins(
			JSON.stringify([
				"https://app.example.test",
				"http://127.0.0.1:4321",
				"https://private:secret@example.test",
				"https://app.example.test/path",
				"not-an-origin",
			]),
		),
	).toEqual(["https://app.example.test", "http://127.0.0.1:4321"]);
});
