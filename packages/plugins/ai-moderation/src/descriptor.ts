import type { PluginDescriptor } from "emdash";

import type { Category } from "./categories.js";

export interface AIModerationOptions {
	categories?: Category[];
	autoApproveClean?: boolean;
	aiBinding?: string;
}

export function aiModerationPlugin(
	options: AIModerationOptions = {},
): PluginDescriptor<AIModerationOptions> {
	return {
		id: "ai-moderation",
		version: "0.1.0",
		entrypoint: "@emdash-cms/plugin-ai-moderation/plugin",
		options,
		adminEntry: "@emdash-cms/plugin-ai-moderation/admin",
		adminPages: [{ path: "/settings", label: "AI Moderation", icon: "shield" }],
		adminWidgets: [{ id: "status", title: "AI Moderation", size: "third" }],
	};
}
