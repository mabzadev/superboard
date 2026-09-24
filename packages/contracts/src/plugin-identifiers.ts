interface PluginIdentity {
	id: string;
	directory: string;
	components: readonly string[];
}

const componentPrefix = /^supbrd-(?:plugmod-|plug-)?/u;

export function canonicalPluginIdentifier(id: string, packages: readonly PluginIdentity[]): string {
	const separator = id.indexOf("__");
	if (separator > 0 && packages.some((entry) => entry.components.includes(id.slice(0, separator))))
		return canonicalPluginIdentifier(
			`${id.slice(0, separator)}.setting.${id.slice(separator + 2)}`,
			packages,
		);
	const [namespace, kind, ...parts] = id.split(".");
	if (!namespace) return id;
	const owner = packages.find(
		(entry) =>
			entry.id === namespace ||
			entry.directory === namespace ||
			entry.components.includes(namespace),
	);
	if (!owner || namespace === owner.directory) return id;
	if (!kind) return owner.directory;
	if (kind === "command" || kind === "data_source")
		return `${owner.directory}.${kind}.${parts.join(".")}`;
	const component = namespace.replace(componentPrefix, "").replaceAll("-", "_");
	return parts.length
		? `${owner.directory}.${kind}.${component}_${parts.join(".")}`
		: `${owner.directory}.${component}_${kind}`;
}
