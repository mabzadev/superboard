import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { Kysely, sql } from "kysely";
import { ulid } from "ulidx";
// @ts-ignore - virtual module populated by EmDash integration at build time
import virtualConfig from "virtual:emdash/config";

import type { EmDashPreviewDB } from "./do-class.js";
import { PreviewDODialect } from "./do-dialect.js";
import type { PreviewDBStub } from "./do-dialect.js";
import { isBlockedInPlayground } from "./do-playground-routes.js";
import { renderPlaygroundLoadingPage } from "./playground-loading.js";
import { renderPlaygroundToolbar } from "./playground-toolbar.js";

const DEFAULT_TTL = 3600;

const COOKIE_NAME = "emdash_playground";

const PLAYGROUND_USER_ID = "playground-admin";
const PLAYGROUND_USER_EMAIL = "playground@emdashcms.com";
const PLAYGROUND_USER_NAME = "Playground User";
const PLAYGROUND_USER_ROLE = 50;

const PLAYGROUND_USER = {
	id: PLAYGROUND_USER_ID,
	email: PLAYGROUND_USER_EMAIL,
	name: PLAYGROUND_USER_NAME,
	role: PLAYGROUND_USER_ROLE,
};

const initializedSessions = new Set<string>();

function getBindingName(): string {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- virtual module import
	const config = virtualConfig as { database?: { config?: { binding?: string } } } | null;
	const binding = config?.database?.config?.binding;
	if (!binding) {
		throw new Error(
			"Playground middleware: no database binding found in config. " +
				"Ensure database: playgroundDatabase({ binding: '...' }) is set.",
		);
	}
	return binding;
}

function getStub(binding: string, token: string): PreviewDBStub {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Worker binding from untyped env
	const ns = (env as Record<string, unknown>)[binding];
	if (!ns) {
		throw new Error(`Playground binding "${binding}" not found in environment`);
	}
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- DO namespace from untyped env
	const namespace = ns as DurableObjectNamespace<EmDashPreviewDB>;
	const doId = namespace.idFromName(token);
	const stub = namespace.get(doId);
	return stub;
}

function getFullStub(binding: string, token: string): DurableObjectStub<EmDashPreviewDB> {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Worker binding from untyped env
	const ns = (env as Record<string, unknown>)[binding];
	if (!ns) {
		throw new Error(`Playground binding "${binding}" not found in environment`);
	}
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- DO namespace from untyped env
	const namespace = ns as DurableObjectNamespace<EmDashPreviewDB>;
	const doId = namespace.idFromName(token);
	return namespace.get(doId);
}

function getSessionCreatedAt(token: string): string {
	try {
		const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
		let time = 0;
		const chars = token.toUpperCase().slice(0, 10);
		for (const char of chars) {
			time = time * 32 + ENCODING.indexOf(char);
		}
		return new Date(time).toISOString();
	} catch {
		return new Date().toISOString();
	}
}

async function initializePlayground(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: Kysely<any>,
	token: string,
): Promise<void> {
	try {
		const { rows } = await sql<{ value: string }>`
			SELECT value FROM options WHERE name = ${"emdash:setup_complete"}
		`.execute(db);

		if (rows.length > 0) {
			return;
		}
	} catch {}

	console.log(`[playground] Initializing session ${token}`);

	const { runMigrations } = await import("emdash/db");
	try {
		const migrations = await runMigrations(db);
		console.log(`[playground] Migrations applied: ${migrations.applied.length}`);
	} catch (migrationError) {
		const msg = migrationError instanceof Error ? migrationError.message : String(migrationError);
		if (msg.includes("already exists")) {
			console.log(`[playground] Migrations skipped (tables already exist)`);
			try {
				await sql`
					INSERT OR IGNORE INTO options (name, value)
					VALUES (${"emdash:setup_complete"}, ${JSON.stringify(true)})
				`.execute(db);
			} catch {}
			return;
		}
		throw migrationError;
	}

	const { loadSeed } = await import("emdash/seed");
	const { applySeed } = await import("emdash");
	const seed = await loadSeed();
	const seedResult = await applySeed(db, seed, {
		includeContent: true,
		onConflict: "skip",
		skipMediaDownload: true,
	});
	console.log(
		`[playground] Seed applied: ${seedResult.collections.created} collections, ${seedResult.content.created} content entries`,
	);

	const now = new Date().toISOString();
	try {
		await sql`
			INSERT INTO users (id, email, name, role, email_verified, created_at, updated_at)
			VALUES (${PLAYGROUND_USER_ID}, ${PLAYGROUND_USER_EMAIL}, ${PLAYGROUND_USER_NAME},
			        ${PLAYGROUND_USER_ROLE}, ${1}, ${now}, ${now})
		`.execute(db);
	} catch {}

	try {
		await sql`
			INSERT INTO options (name, value)
			VALUES (${"emdash:setup_complete"}, ${JSON.stringify(true)})
		`.execute(db);
	} catch {}

	try {
		await sql`
			INSERT OR REPLACE INTO options (name, value)
			VALUES (${"emdash:site_title"}, ${JSON.stringify("EmDash Playground")})
		`.execute(db);
	} catch {}

	console.log(`[playground] Session ${token} initialized`);
}

async function injectPlaygroundToolbar(
	response: Response,
	config: { createdAt: string; ttl: number; editMode: boolean },
): Promise<Response> {
	const contentType = response.headers.get("content-type");
	if (!contentType?.includes("text/html")) return response;

	const html = await response.text();
	if (!html.includes("</body>")) return new Response(html, response);

	const toolbarHtml = renderPlaygroundToolbar(config);
	const injected = html.replace("</body>", `${toolbarHtml}</body>`);
	return new Response(injected, {
		status: response.status,
		headers: response.headers,
	});
}

export const onRequest = defineMiddleware(async (context, next) => {
	const { url, cookies } = context;
	const ttl = DEFAULT_TTL;

	const binding = getBindingName();

	if (url.pathname === "/playground") {
		let token = cookies.get(COOKIE_NAME)?.value;
		if (!token) {
			token = ulid();
			cookies.set(COOKIE_NAME, token, {
				httpOnly: true,
				sameSite: "lax",
				path: "/",
				maxAge: ttl,
			});
		}

		if (initializedSessions.has(token)) {
			return context.redirect("/_emdash/admin");
		}

		return new Response(renderPlaygroundLoadingPage(), {
			status: 200,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	if (url.pathname === "/_playground/init" && context.request.method === "POST") {
		const token = cookies.get(COOKIE_NAME)?.value;
		if (!token) {
			return Response.json(
				{ error: { code: "NO_SESSION", message: "No playground session" } },
				{ status: 400 },
			);
		}

		if (initializedSessions.has(token)) {
			return Response.json({ ok: true });
		}

		const stub = getStub(binding, token);
		const dialect = new PreviewDODialect({ getStub: () => stub });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const db = new Kysely<any>({ dialect });

		try {
			await initializePlayground(db, token);
			console.log(`[playground] Session ${token} initialized`);
			initializedSessions.add(token);
			const fullStub = getFullStub(binding, token);
			console.log(`[playground] Setting TTL alarm for session ${token} (${ttl} seconds)`);
			await fullStub.setTtlAlarm(ttl);
			console.log(`[playground] TTL alarm set for session ${token}`);
			return Response.json({ ok: true });
		} catch (error) {
			console.error("Playground initialization failed:", error);
			if (error instanceof Error) {
				console.error(error.stack);
			}
			return Response.json(
				{ error: { code: "PLAYGROUND_INIT_ERROR", message: "Failed to initialize playground" } },
				{ status: 500 },
			);
		}
	}

	if (url.pathname === "/_playground/reset") {
		cookies.delete(COOKIE_NAME, { path: "/" });
		return context.redirect("/playground");
	}

	if (isBlockedInPlayground(url.pathname)) {
		return Response.json(
			{ error: { code: "PLAYGROUND_MODE", message: "Not available in playground mode" } },
			{ status: 403 },
		);
	}

	const token = cookies.get(COOKIE_NAME)?.value;
	if (!token) {
		return context.redirect("/playground");
	}

	const stub = getStub(binding, token);
	const dialect = new PreviewDODialect({ getStub: () => stub });
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const db = new Kysely<any>({ dialect });

	if (!initializedSessions.has(token)) {
		try {
			await initializePlayground(db, token);
			initializedSessions.add(token);
			const fullStub = getFullStub(binding, token);
			await fullStub.setTtlAlarm(ttl);
		} catch (error) {
			console.error("Playground initialization failed:", error);
			return Response.json(
				{ error: { code: "PLAYGROUND_INIT_ERROR", message: "Failed to initialize playground" } },
				{ status: 500 },
			);
		}
	}

	Object.assign(context.locals, { __playgroundDb: db, user: PLAYGROUND_USER });

	const editMode = cookies.get("emdash-edit-mode")?.value === "true";

	const response = await next();

	return injectPlaygroundToolbar(response, {
		createdAt: getSessionCreatedAt(token),
		ttl,
		editMode,
	});
});
