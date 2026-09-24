import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { PluginDiagnosticData } from "@superboard/contracts/plugin-diagnostic";

import { apiFetch, parseApiResponse } from "./client.js";

export async function fetchPluginDiagnostic(pluginId: string, recheck = false) {
	const action = recheck ? "health" : "diagnostic";
	const response = await apiFetch(
		`/_emdash/api/superboard/plugins/${encodeURIComponent(pluginId)}/${action}?include_disabled=1&envelope=1`,
		{
			method: recheck ? "POST" : "GET",
		},
	);
	const data = await parseApiResponse<PluginDiagnosticData>(
		response,
		i18n._(msg`Failed to load plugin configuration`),
	);
	if (data.pluginId !== pluginId)
		throw new Error(i18n._(msg`Plugin configuration does not match the requested plugin`));
	return data;
}
