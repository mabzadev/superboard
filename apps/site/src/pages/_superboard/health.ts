import type { APIRoute } from "astro";

import { jsonResponse } from "../../lib/operator-guard.js";

export const prerender = false;

export const GET: APIRoute = () =>
	jsonResponse({ status: "ok", service: "superboard-site", schema_version: 1 });
