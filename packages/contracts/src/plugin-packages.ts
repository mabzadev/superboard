import definitions from "../../../scripts/config/superboard-plugin-packages.json";

export const pluginPackages = definitions.packages;

export function pluginPackage(id: string) {
	return pluginPackages.find((item) => item.id === id || item.components.includes(id));
}

export function pluginPackageOwner(id: string): string {
	return pluginPackage(id)?.id ?? id;
}

export function pluginPackageComponents(id: string): readonly string[] {
	return pluginPackage(id)?.components ?? [id];
}

export function pluginSettingLocation(component: string, key: string) {
	const owner = pluginPackage(component);
	return owner && owner.id !== component && owner.components.includes(component)
		? { pluginId: owner.id, key: `${component}__${key}` }
		: { pluginId: component, key };
}

export function componentSettingKey(packageId: string, key: string) {
	const owner = pluginPackages.find((item) => item.id === packageId);
	const component = owner?.components.find((id) => key.startsWith(`${id}__`));
	return component ? { component, key: key.slice(component.length + 2) } : null;
}

export function installedPluginPackages(componentIds: readonly string[]) {
	const selected = new Set(componentIds);
	return pluginPackages.filter(
		(item) => item.kind === "core" || item.components.some((id) => selected.has(id)),
	);
}

export function pluginComponentForContribution(pluginId: string, contributionId: string): string {
	const component = contributionId.split(".")[0];
	const owner = pluginPackage(pluginId);
	if (component && owner?.components.includes(component)) return component;
	return owner?.components.length === 1 ? owner.components[0]! : pluginId;
}
