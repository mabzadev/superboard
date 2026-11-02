import type { MiddlewareHandler } from "astro";
import { env } from "cloudflare:workers";
import { runWithContext } from "emdash/request-context";
import { Kysely } from "kysely";
import { ulid } from "ulidx";

import type { EmDashPreviewDB } from "./do-class.js";
import { PreviewDODialect } from "./do-dialect.js";
import type { PreviewDBStub } from "./do-dialect.js";
import { isBlockedInPreview } from "./do-preview-routes.js";
import { verifyPreviewSignature } from "./do-preview-sign.js";
import { renderPreviewToolbar } from "./preview-toolbar.js";

export interface PreviewMiddlewareConfig {
	binding: string;
	secret: string;
	ttl?: number;
	cookieName?: string;
}

function loadingPage(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="2">
<title>Loading preview...</title>
<link rel="icon" href="data:image/svg+xml,<svg width='75' height='75' viewBox='0 0 75 75' fill='none' xmlns='http://www.w3.org/2000/svg'><rect x='3' y='3' width='69' height='69' rx='10.518' stroke='url(%23pb)' stroke-width='6'/><rect x='18' y='34' width='39.366' height='6.561' fill='url(%23pd)'/><defs><linearGradient id='pb' x1='-43' y1='124' x2='92.42' y2='-41.75' gradientUnits='userSpaceOnUse'><stop stop-color='%230F006B'/><stop offset='.08' stop-color='%23281A81'/><stop offset='.17' stop-color='%235D0C83'/><stop offset='.25' stop-color='%23911475'/><stop offset='.33' stop-color='%23CE2F55'/><stop offset='.42' stop-color='%23FF6633'/><stop offset='.5' stop-color='%23F6821F'/><stop offset='.58' stop-color='%23FBAD41'/><stop offset='.67' stop-color='%23FFCD89'/><stop offset='.75' stop-color='%23FFE9CB'/><stop offset='.83' stop-color='%23FFF7EC'/><stop offset='.92' stop-color='%23FFF8EE'/><stop offset='1' stop-color='white'/></linearGradient><linearGradient id='pd' x1='91.5' y1='27.5' x2='28.12' y2='54.18' gradientUnits='userSpaceOnUse'><stop stop-color='white'/><stop offset='.13' stop-color='%23FFF8EE'/><stop offset='.62' stop-color='%23FBAD41'/><stop offset='.85' stop-color='%23F6821F'/><stop offset='1' stop-color='%23FF6633'/></linearGradient></defs></svg>" />
<style>
body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #fafafa; color: #333; }
.spinner { width: 40px; height: 40px; border: 3px solid #e0e0e0; border-top-color: #333; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 16px; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="spinner"></div>
<p>Loading preview&hellip;</p>
</body>
</html>`;
}

export function createPreviewMiddleware(config: PreviewMiddlewareConfig): MiddlewareHandler {
	const { binding, secret, ttl = 3600, cookieName = "emdash_preview" } = config;

	return async function previewMiddleware(context, next) {
		const { url, cookies } = context;

		if (url.pathname === "/_preview/reload") {
			cookies.delete(cookieName, { path: "/" });
			let redirectTo = "/";
			const paramsCookie = cookies.get(`${cookieName}_params`)?.value;
			if (paramsCookie) {
				const parts = decodeURIComponent(paramsCookie).split("\n");
				if (parts.length === 3) {
					const reloadUrl = new URL("/", url.origin);
					reloadUrl.searchParams.set("source", parts[0]!);
					reloadUrl.searchParams.set("exp", parts[1]!);
					reloadUrl.searchParams.set("sig", parts[2]!);
					redirectTo = reloadUrl.pathname + reloadUrl.search;
				}
			}
			return context.redirect(redirectTo);
		}

		if (isBlockedInPreview(url.pathname)) {
			return Response.json(
				{ error: { code: "PREVIEW_MODE", message: "Not available in preview mode" } },
				{ status: 403 },
			);
		}

		let sessionToken: string | undefined = cookies.get(cookieName)?.value;
		let sourceUrl: string | null = null;
		let snapshotSignature: string | null = null;

		if (!sessionToken) {
			const source = url.searchParams.get("source");
			const exp = url.searchParams.get("exp");
			const sig = url.searchParams.get("sig");

			if (!source || !exp || !sig) {
				return new Response("Missing preview parameters", { status: 400 });
			}

			const expNum = parseInt(exp, 10);
			if (isNaN(expNum) || expNum < Date.now() / 1000) {
				return new Response("Preview link expired", { status: 403 });
			}

			const valid = await verifyPreviewSignature(source, expNum, sig, secret);
			if (!valid) {
				return new Response("Invalid preview signature", { status: 403 });
			}

			sessionToken = ulid();
			sourceUrl = source;
			snapshotSignature = `${source}:${exp}:${sig}`;

			cookies.set(cookieName, sessionToken, {
				httpOnly: true,
				sameSite: "lax",
				path: "/",
				maxAge: ttl,
			});
			cookies.set(`${cookieName}_params`, `${source}\n${exp}\n${sig}`, {
				sameSite: "lax",
				path: "/",
				maxAge: ttl,
			});
		}

		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Worker binding from untyped env
		const ns = (env as Record<string, unknown>)[binding];
		if (!ns) {
			console.error(`Preview binding "${binding}" not found in environment`);
			return new Response("Preview service misconfigured", { status: 500 });
		}
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- DO namespace from untyped env
		const namespace = ns as DurableObjectNamespace<EmDashPreviewDB>;
		const doId = namespace.idFromName(sessionToken);
		const stub = namespace.get(doId);

		let snapshotGeneratedAt: string | undefined;
		let snapshotError: string | undefined;

		if (!sourceUrl) {
			try {
				const meta = await stub.getSnapshotMeta();
				snapshotGeneratedAt = meta?.generatedAt;
			} catch {}
		}

		if (sourceUrl && snapshotSignature) {
			try {
				const result = await stub.populateFromSnapshot(sourceUrl, snapshotSignature, { ttl });
				snapshotGeneratedAt = result.generatedAt;

				const cleanUrl = new URL(url);
				cleanUrl.searchParams.delete("source");
				cleanUrl.searchParams.delete("exp");
				cleanUrl.searchParams.delete("sig");
				return context.redirect(cleanUrl.pathname + cleanUrl.search);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error("Failed to populate preview snapshot:", message);
				snapshotError = message;

				if (!cookies.get(cookieName)?.value) {
					return new Response(loadingPage(), {
						status: 503,
						headers: {
							"Content-Type": "text/html",
							"Retry-After": "2",
						},
					});
				}
			}
		}

		const getStub = (): PreviewDBStub => {
			return stub;
		};
		const dialect = new PreviewDODialect({ getStub });

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const previewDb = new Kysely<any>({ dialect });

		return runWithContext(
			{
				editMode: false,
				db: previewDb,
			},
			async () => {
				const response = await next();
				return injectPreviewToolbar(response, {
					generatedAt: snapshotGeneratedAt,
					source: sourceUrl ?? undefined,
					error: snapshotError,
				});
			},
		);
	};
}

async function injectPreviewToolbar(
	response: Response,
	config: { generatedAt?: string; source?: string; error?: string },
): Promise<Response> {
	const contentType = response.headers.get("content-type");
	if (!contentType?.includes("text/html")) return response;

	const html = await response.text();
	if (!html.includes("</body>")) return new Response(html, response);

	const toolbarHtml = renderPreviewToolbar(config);
	const injected = html.replace("</body>", `${toolbarHtml}</body>`);
	return new Response(injected, {
		status: response.status,
		headers: response.headers,
	});
}
