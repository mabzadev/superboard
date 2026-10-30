interface PluginIdentity {
	id: string;
	directory: string;
	components: readonly string[];
}

const componentPrefix = /^(?:supbrd-(?:plugmod-|plug-)?|superboard-)/u;

export const LEGACY_PLUGIN_IDS: Readonly<Record<string, string>> = {
	"supbrd-core": "superboard-core",
	"supbrd-plug-identity": "superboard-authentification",
	"supbrd-plug-data": "superboard-data",
	"supbrd-plug-commerce": "superboard-monetization",
	"supbrd-plug-communication": "superboard-communication",
	"supbrd-plug-journeys": "superboard-acquisition",
	"supbrd-plug-support": "superboard-support",
	"supbrd-plug-analytics": "superboard-analytics",
};

export function canonicalPluginIdentifier(id: string, packages: readonly PluginIdentity[]): string {
	const separator = id.indexOf("__");
	if (separator > 0 && packages.some((entry) => entry.components.includes(id.slice(0, separator))))
		return canonicalPluginIdentifier(
			`${id.slice(0, separator)}.setting.${id.slice(separator + 2)}`,
			packages,
		);
	const [rawNamespace, kind, ...parts] = id.split(".");
	if (!rawNamespace) return id;
	const namespace = LEGACY_PLUGIN_IDS[rawNamespace] ?? rawNamespace;
	const owner = packages.find(
		(entry) =>
			entry.id === namespace ||
			entry.directory === namespace ||
			entry.components.includes(rawNamespace) ||
			entry.components.includes(namespace),
	);
	if (!owner) return id;
	const component = namespace.replace(componentPrefix, "").replaceAll("-", "_");
	if (rawNamespace === owner.directory) {
		if (!owner.components.includes(rawNamespace)) return id;
		if (kind === "command" || kind === "data_source") return id;
		if (parts.length ? parts[0]?.startsWith(`${component}_`) : kind?.startsWith(`${component}_`))
			return id;
	}
	if (!kind) return owner.directory;
	if (kind === "command" || kind === "data_source")
		return `${owner.directory}.${kind}.${parts.join(".")}`;
	return parts.length
		? `${owner.directory}.${kind}.${component}_${parts.join(".")}`
		: `${owner.directory}.${component}_${kind}`;
}
