import type { APIRoute } from "astro";

import { dispatchPluginApiAdapter } from "../../../../../../lib/plugin-api-adapter.js";
export const prerender = false;
export const POST: APIRoute = (context) => dispatchPluginApiAdapter(context, "command");
