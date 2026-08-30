import type { RendererDescriptor } from "./contracts.js";

export interface RendererRuntimeCompatibility {
	abi_version: string;
	runtime_version: string;
}

export function assertRendererCompatibility(
	descriptor: RendererDescriptor,
	runtime: RendererRuntimeCompatibility,
): void {
	const [minimum, maximum] = descriptor.runtime_range.split(" ");
	if (
		descriptor.abi_version !== runtime.abi_version ||
		minimum !== `>=${runtime.runtime_version}` ||
		maximum !== "<0.2.0"
	) {
		throw new Error(`Renderer compatibility rejected for ${descriptor.renderer_id}`);
	}
}
