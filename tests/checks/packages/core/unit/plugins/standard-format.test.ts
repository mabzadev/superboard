import { describe, it, expect, vi } from "vitest";

import type { PluginDescriptor } from "../../../../../../packages/core/src/astro/integration/runtime.js";
import { generatePluginsModule } from "../../../../../../packages/core/src/astro/integration/virtual-modules.js";
import { definePlugin } from "../../../../../../packages/core/src/plugins/define-plugin.js";

describe("definePlugin()", () => {
	it("returns a resolved native plugin for input with id + version", () => {
		const handler = vi.fn();
		const result = definePlugin({
			id: "native-plugin",
			version: "1.0.0",
			hooks: {
				"content:beforeSave": handler,
			},
		});

		expect(result.id).toBe("native-plugin");
		expect(result.version).toBe("1.0.0");
		expect(result.hooks["content:beforeSave"]).toBeDefined();
		expect(result.hooks["content:beforeSave"]!.pluginId).toBe("native-plugin");
	});

	it("throws when called without an id (sandboxed-shape input)", () => {
		expect(() =>
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional type bypass for runtime check coverage
			definePlugin({ hooks: {} } as any),
		).toThrow(/SandboxedPlugin/);
	});

	it("throws when id is the empty string", () => {
		expect(() =>
			definePlugin({
				id: "",
				version: "1.0.0",
			}),
		).toThrow(/requires `id`/);
	});
});

describe("generatePluginsModule() standard format", () => {
	it("generates adapter import for standard-format plugins", () => {
		const descriptors: PluginDescriptor[] = [
			{
				id: "my-standard-plugin",
				version: "1.0.0",
				entrypoint: "@my/standard-plugin",
				format: "standard",
			},
		];

		const code = generatePluginsModule(descriptors);

		expect(code).toContain("adaptSandboxEntry");
		expect(code).toContain('from "emdash/plugins/adapt-sandbox-entry"');
		expect(code).toContain('import pluginDef0 from "@my/standard-plugin"');
		expect(code).toContain("adaptSandboxEntry(pluginDef0");
	});

	it("generates createPlugin import for native-format plugins", () => {
		const descriptors: PluginDescriptor[] = [
			{
				id: "my-native-plugin",
				version: "1.0.0",
				entrypoint: "@my/native-plugin",
				options: { debug: true },
			},
		];

		const code = generatePluginsModule(descriptors);

		expect(code).not.toContain("adaptSandboxEntry");
		expect(code).toContain('import { createPlugin as createPlugin0 } from "@my/native-plugin"');
		expect(code).toContain('createPlugin0({"debug":true})');
	});

	it("handles mixed standard and native plugins", () => {
		const descriptors: PluginDescriptor[] = [
			{
				id: "native-plugin",
				version: "1.0.0",
				entrypoint: "@my/native-plugin",
				options: {},
			},
			{
				id: "standard-plugin",
				version: "2.0.0",
				entrypoint: "@my/standard-plugin",
				format: "standard",
				capabilities: ["content:read"],
			},
		];

		const code = generatePluginsModule(descriptors);

		expect(code).toContain("adaptSandboxEntry");

		expect(code).toContain('import { createPlugin as createPlugin0 } from "@my/native-plugin"');
		expect(code).toContain("createPlugin0(");

		expect(code).toContain('import pluginDef1 from "@my/standard-plugin"');
		expect(code).toContain("adaptSandboxEntry(pluginDef1");
	});

	it("does not import adapter when all plugins are native", () => {
		const descriptors: PluginDescriptor[] = [
			{
				id: "native-1",
				version: "1.0.0",
				entrypoint: "@my/native-1",
				options: {},
			},
			{
				id: "native-2",
				version: "1.0.0",
				entrypoint: "@my/native-2",
				options: {},
				format: "native",
			},
		];

		const code = generatePluginsModule(descriptors);

		expect(code).not.toContain("adaptSandboxEntry");
	});

	it("returns empty plugins array for no descriptors", () => {
		const code = generatePluginsModule([]);

		expect(code).toBe("export const plugins = [];");
	});

	it("throws an actionable error when a descriptor has no entrypoint (issue #1416)", () => {
		const descriptors = [
			{
				id: "misarico-resend-email",
				version: "0.0.0",
				capabilities: ["hooks.email-transport:register"],
			},
		] as unknown as PluginDescriptor[];

		let error: Error | undefined;
		try {
			generatePluginsModule(descriptors);
		} catch (e) {
			error = e as Error;
		}

		expect(error).toBeDefined();
		expect(error!.message).toContain("misarico-resend-email");
		expect(error!.message).toMatch(/entrypoint/i);
		expect(error!.message).not.toContain('"undefined"');
	});

	it("serializes descriptor metadata for standard plugins", () => {
		const descriptors: PluginDescriptor[] = [
			{
				id: "my-plugin",
				version: "1.0.0",
				entrypoint: "@my/plugin",
				format: "standard",
				capabilities: ["content:read", "network:request"],
				allowedHosts: ["api.example.com"],
				storage: { events: { indexes: ["timestamp"] } },
				adminPages: [{ path: "/settings", label: "Settings" }],
			},
		];

		const code = generatePluginsModule(descriptors);

		expect(code).toContain('"id":"my-plugin"');
		expect(code).toContain('"version":"1.0.0"');
		expect(code).toContain('"capabilities":["content:read","network:request"]');
		expect(code).toContain('"allowedHosts":["api.example.com"]');
		expect(code).toContain('"storage":{"events":{"indexes":["timestamp"]}}');
	});
});
