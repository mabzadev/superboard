import { expect, test } from "vitest";

import {
	parseConsoleEnvironments,
	resolveConsoleDeployment,
} from "../../../../apps/site/src/lib/deployment-context.js";

const catalog = [
	{
		id: "demo.development",
		application: "Demo",
		label: "Development",
		environment: "development",
		apiUrl: "https://api.dev.example",
		consoleUrl: "https://console.dev.example",
	},
	{
		id: "demo.production",
		application: "Demo",
		label: "Production",
		environment: "production",
		apiUrl: "https://api.example",
		consoleUrl: "https://console.example",
	},
];

test("the selected deployment retains its own API instead of selecting a project data mode", () => {
	const result = resolveConsoleDeployment({
		catalog: JSON.stringify(catalog),
		instanceId: "demo",
		environment: "development",
		apiUrl: "https://api.dev.example",
	});
	expect(result.deployment?.apiUrl).toBe("https://api.dev.example");
	expect(result.environments[1]?.apiUrl).toBe("https://api.example");
});

test("a production API cannot be presented as the development deployment", () => {
	expect(() =>
		resolveConsoleDeployment({
			catalog: JSON.stringify(catalog),
			instanceId: "demo",
			environment: "development",
			apiUrl: "https://api.example",
		}),
	).toThrow("DEPLOYMENT_CONTEXT_MISMATCH");
});

test.each([
	"javascript:alert(1)",
	"https://user:password@example.test",
	"https://example.test/redirect?to=elsewhere",
	"http://api.example.test",
])("rejects an untrusted deployment destination %s", (consoleUrl) => {
	expect(() => parseConsoleEnvironments(JSON.stringify([{ ...catalog[0], consoleUrl }]))).toThrow();
});
