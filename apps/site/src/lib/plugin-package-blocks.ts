import type { pluginPackage } from "@superboard/contracts/plugin-packages";

import type { BlockResponse } from "../../../../packages/blocks/src/types.js";

export function packageFeatureBlocks(input: {
	owner: NonNullable<ReturnType<typeof pluginPackage>>;
	active: ReadonlySet<string>;
	available: readonly string[];
	labels: {
		title: string;
		description: string;
		enabled: string;
		disabled: string;
		required: string;
		unavailable: string;
		enable: string;
		disable: string;
	};
}): BlockResponse {
	const { owner, active, available, labels } = input;
	const blocks: BlockResponse["blocks"] = [
		{ type: "header", text: labels.title },
		{ type: "section", text: labels.description },
	];
	for (const component of owner.components) {
		const enabled = active.has(component);
		const label = component.replace(componentPrefixPattern, "");
		blocks.push({
			type: "section",
			text: `${label} · ${enabled ? labels.enabled : labels.disabled}${owner.required_components.includes(component) ? ` · ${labels.required}` : ""}`,
		});
		if (!available.includes(component)) blocks.push({ type: "section", text: labels.unavailable });
		else if (!enabled || !owner.required_components.includes(component))
			blocks.push({
				type: "actions",
				elements: [
					{
						type: "button",
						label: enabled ? labels.disable : labels.enable,
						action_id: `package-feature:${component}:${enabled ? "disable" : "enable"}`,
					},
				],
			});
	}
	return { blocks };
}
const componentPrefixPattern = /^supbrd-(?:plug|plugmod)-/u;
