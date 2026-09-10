import { pluginPackage } from "@superboard/contracts/plugin-packages";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { packageFeatureBlocks } from "../../../../apps/site/src/lib/plugin-package-blocks.js";
import { BlockRenderer } from "../../../../packages/blocks/src/renderer.js";

const labels = {
	title: "Parcours",
	description: "Fonctions",
	enabled: "Activée",
	disabled: "Désactivée",
	required: "Obligatoire",
	unavailable: "Non déployée",
	enable: "Activer",
	disable: "Désactiver",
};

test("operators can identify the controls for active and disabled functions", () => {
	const owner = pluginPackage("supbrd-plug-journeys")!;
	const response = packageFeatureBlocks({
		owner,
		active: new Set([owner.components[0]!]),
		available: owner.components,
		labels,
	});
	const root = document.createElement("div");
	root.innerHTML = renderToStaticMarkup(
		<BlockRenderer blocks={response.blocks} onAction={() => {}} />,
	);
	expect(Array.from(root.querySelectorAll("button"), (button) => button.textContent)).toEqual([
		"Désactiver",
		"Activer",
	]);
});

test("required functions cannot be disabled and missing functions cannot be enabled", () => {
	const owner = pluginPackage("supbrd-core")!;
	const response = packageFeatureBlocks({
		owner,
		active: new Set(owner.required_components),
		available: owner.required_components,
		labels,
	});
	const root = document.createElement("div");
	root.innerHTML = renderToStaticMarkup(
		<BlockRenderer blocks={response.blocks} onAction={() => {}} />,
	);
	expect(root.querySelectorAll("button")).toHaveLength(0);
	expect(root.textContent).toContain("Non déployée");
});
