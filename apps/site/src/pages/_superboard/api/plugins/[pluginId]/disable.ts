import type { APIRoute } from "astro";

import { runManagedPluginLifecycleAction } from "../../../../../lib/managed-plugin-lifecycle-action.js";

export const prerender = false;

export const POST: APIRoute = async (context) =>
	runManagedPluginLifecycleAction(context, "disable");
