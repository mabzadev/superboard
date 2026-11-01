import { canonicalPluginId, pluginPackage } from "@superboard/contracts/plugin-packages";

import { useOptionalFrontContext } from "./context.js";

export interface PluginDiagnosticsLinkProps {
	pluginId?: string;
	locale?: string;
	className?: string;
}

const messages = {
	en: {
		text: "Health, lifecycle and diagnostics for this module are available in Plugins.",
		link: "Open in Plugins",
	},
	fr: {
		text: "La santé, le cycle de vie et les diagnostics de ce module sont disponibles dans Plugins.",
		link: "Ouvrir dans Plugins",
	},
} as const;

/** Address of the central Plugins diagnostics page for a plugin or one of its components. */
export function pluginDiagnosticsHref(pluginId: string): string {
	const directory = pluginPackage(canonicalPluginId(pluginId))?.directory ?? pluginId;
	return `/_emdash/admin/plugins-manager/${encodeURIComponent(directory)}/configuration`;
}

/** Points module settings to the central Plugins page, which owns plugin health and lifecycle. */
export function PluginDiagnosticsLink({ pluginId, locale, className }: PluginDiagnosticsLinkProps) {
	const front = useOptionalFrontContext();
	const id = front?.pluginId ?? pluginId;
	const t =
		messages[(locale ?? front?.locale ?? "en").toLowerCase().startsWith("fr") ? "fr" : "en"];
	if (!id) return null;
	return (
		<p className={`text-sm text-muted-foreground ${className ?? ""}`.trim()}>
			{t.text}{" "}
			<a className="underline" href={pluginDiagnosticsHref(id)}>
				{t.link}
			</a>
		</p>
	);
}
