import type { APIRoute } from "astro";

import { handlePluginTaskAuthority } from "../../lib/plugin-task-authority.js";
import { getSiteEnv } from "../../lib/site-env.js";
export const prerender = false;
export const POST: APIRoute = ({ request }) => handlePluginTaskAuthority(request, getSiteEnv());
