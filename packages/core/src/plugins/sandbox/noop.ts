import type { PluginManifest } from "../types.js";
import type { SandboxRunner, SandboxedPluginInstance, SandboxOptions } from "./types.js";

export class SandboxNotAvailableError extends Error {
	constructor() {
		super(
			"Plugin sandboxing is not available. " +
				"Configure a sandbox runner: use @emdash-cms/cloudflare/sandbox on Cloudflare, " +
				"or @emdash-cms/sandbox-workerd/sandbox on Node.js (requires workerd). " +
				"Without sandboxing, use trusted plugins (from config) instead.",
		);
		this.name = "SandboxNotAvailableError";
	}
}

export class NoopSandboxRunner implements SandboxRunner {
	isAvailable(): boolean {
		return false;
	}

	isHealthy(): boolean {
		return false;
	}

	async load(
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		_manifest: PluginManifest,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		_code: string,
	): Promise<SandboxedPluginInstance> {
		throw new SandboxNotAvailableError();
	}

	setEmailSend(): void {}

	async terminateAll(): Promise<void> {}
}

export function createNoopSandboxRunner(_options?: SandboxOptions): SandboxRunner {
	return new NoopSandboxRunner();
}
