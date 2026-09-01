import {
	REQUIRED_FRONT_STATES,
	sha256Canonical,
	type FrontState,
	type RendererDescriptor,
} from "@superboard/supbrd-core";

const corePlugin = { plugin_id: "supbrd-core", plugin_version: "0.1.0" } as const;

export const CORE_ADMIN_SHELL_RENDERER_ID = "emdash.core.renderer.admin_shell";
export const CORE_STATE_RENDERER_IDS = Object.fromEntries(
	REQUIRED_FRONT_STATES.map((state) => [state, `emdash.core.state.${state}`]),
) as Record<FrontState, string>;

const propsSchemaChecksum = await sha256Canonical({
	type: "object",
	additionalProperties: false,
	properties: {},
});

export const CORE_FRONT_RENDERER_DESCRIPTORS: RendererDescriptor[] = await Promise.all([
	descriptor(CORE_ADMIN_SHELL_RENDERER_ID, "01J00000000000000000000243", ["content"]),
	...REQUIRED_FRONT_STATES.map((state, index) =>
		descriptor(
			CORE_STATE_RENDERER_IDS[state],
			`01J00000000000000000000${String(250 + index).padStart(3, "0")}`,
			[],
		),
	),
]);

export const CORE_ADMIN_SHELL_DESCRIPTOR = CORE_FRONT_RENDERER_DESCRIPTORS[0]!;
export const SUPBRD_CORE_ARTIFACT_CHECKSUM = await sha256Canonical({
	runtime: "superboard.native_front.v1",
	renderers: CORE_FRONT_RENDERER_DESCRIPTORS,
});

async function descriptor(
	rendererId: string,
	buildId: string,
	slots: string[],
): Promise<RendererDescriptor> {
	return {
		renderer_id: rendererId,
		...corePlugin,
		build_id: buildId,
		build_checksum: await sha256Canonical({ renderer_id: rendererId, runtime: "native_front.v1" }),
		abi_version: "1.0.0",
		runtime_range: ">=0.1.0 <0.2.0",
		props_schema: {
			schema_id: `${rendererId}.props.v1`,
			version: "1.0.0",
			checksum: propsSchemaChecksum,
		},
		capabilities: ["renderer.mount"],
		slots,
		supported_states: [...REQUIRED_FRONT_STATES],
	};
}
