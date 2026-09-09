export const prerender = false;
import type { APIRoute } from "astro";

import { runtimePluginSettings } from "../../../lib/runtime-plugin-settings.js";
import { getSiteEnv } from "../../../lib/site-env.js";

export const GET: APIRoute = ({ request, params }) =>
	runtimePluginSettings(request, params.pluginId ?? "", getSiteEnv());
