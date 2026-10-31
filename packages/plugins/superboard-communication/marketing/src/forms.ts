import { registerRouter } from "@superboard/contracts/route-registry";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { coerceFieldValue, fieldDefinitions, type FieldDefinition } from "./audience-fields";
import {
	escapeHtml,
	plainText,
	publicPage,
	requestLocale,
	type AudienceBindings,
} from "./audience-shared";
import { failure } from "./auth";
import { readBrandKit } from "./brand-kit.js";
import { doubleOptInListIds, queueDoubleOptIns } from "./optin";
import { sha256 } from "./secrets";
import type { Env } from "./types";
import {
	jsonObject,
	optionalText,
	parseStoredJson,
	readJsonObject,
	stringArray,
	text,
} from "./validation";

type SignupFormSettings = {
	locale: "en" | "fr";
	title: string;
	description: string | null;
	submit_label: string;
	fields: Array<{ key: string; required: boolean }>;
	list_ids: string[];
	double_opt_in: boolean;
	success_message: string | null;
	redirect_url: string | null;
	popup: { enabled: boolean; delay_seconds: number };
};

const MAX_FORM_FIELDS = 8;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_ATTEMPTS = 8;
const MAX_FORMS_PER_PROJECT = 50;
const HONEYPOT = "website";

const copy = {
	en: {
		title: "Subscribe to our newsletter",
		submit: "Subscribe",
		email: "Email",
		name: "Name",
		success: "Thanks for subscribing!",
		confirm: "Almost there: check your inbox to confirm your subscription.",
		invalidEmail: "Enter a valid email address.",
		missing: "Fill in the required fields.",
		invalidField: "One of the fields is invalid.",
		rateLimited: "Too many attempts. Please try again in a few minutes.",
		unavailable: "This form is not available.",
		close: "Close",
	},
	fr: {
		title: "Abonnez-vous à notre newsletter",
		submit: "S’abonner",
		email: "E-mail",
		name: "Nom",
		success: "Merci pour votre inscription !",
		confirm:
			"Encore une étape : consultez votre boîte de réception pour confirmer votre inscription.",
		invalidEmail: "Saisissez une adresse e-mail valide.",
		missing: "Remplissez les champs obligatoires.",
		invalidField: "Un des champs est invalide.",
		rateLimited: "Trop de tentatives. Réessayez dans quelques minutes.",
		unavailable: "Ce formulaire n’est pas disponible.",
		close: "Fermer",
	},
} as const;

export const signupFormRoutes = registerRouter(new Hono<AudienceBindings>(), {
	service: "marketing",
	module: "forms.signupFormRoutes",
	pluginId: "superboard-marketing",
	surface: "internal",
	access: "internal",
});

signupFormRoutes.get("/audience/forms", async (c) => {
	const rows = await c.env.DB.prepare(
		"SELECT * FROM marketing_signup_forms WHERE project_id = ? ORDER BY updated_at DESC",
	)
		.bind(c.get("project").projectId)
		.all<Record<string, unknown>>();
	return c.json({ data: rows.results.map(serializeForm) });
});

signupFormRoutes.post("/audience/forms", async (c) => {
	const projectId = c.get("project").projectId;
	const body = await readJsonObject(c.req.raw);
	const count = await c.env.DB.prepare(
		"SELECT COUNT(*) total FROM marketing_signup_forms WHERE project_id = ?",
	)
		.bind(projectId)
		.first<{ total: number }>();
	if (Number(count?.total || 0) >= MAX_FORMS_PER_PROJECT)
		throw failure(
			"form_limit_reached",
			`A project can have at most ${MAX_FORMS_PER_PROJECT} forms`,
			409,
		);
	const name = text(body.name, "name", 120);
	await ensureUniqueName(c.env.DB, projectId, name);
	const settings = await validateFormSettings(
		c.env.DB,
		projectId,
		body,
		defaultSettings(body.locale),
	);
	const id = crypto.randomUUID();
	await c.env.DB.prepare(
		"INSERT INTO marketing_signup_forms (id, project_id, name, status, settings_json) VALUES (?, ?, ?, ?, ?)",
	)
		.bind(id, projectId, name, formStatus(body.status, "active"), JSON.stringify(settings))
		.run();
	return c.json({ data: serializeForm(await signupForm(c.env.DB, projectId, id)) }, 201);
});

signupFormRoutes.patch("/audience/forms/:formId", async (c) => {
	const projectId = c.get("project").projectId;
	const current = await signupForm(c.env.DB, projectId, c.req.param("formId"));
	const body = await readJsonObject(c.req.raw);
	const name = body.name === undefined ? String(current.name) : text(body.name, "name", 120);
	if (name !== current.name) await ensureUniqueName(c.env.DB, projectId, name, String(current.id));
	const settings = await validateFormSettings(
		c.env.DB,
		projectId,
		body,
		parseStoredJson<SignupFormSettings>(current.settings_json, defaultSettings("en")),
	);
	await c.env.DB.prepare(
		`UPDATE marketing_signup_forms SET name = ?, status = ?, settings_json = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND id = ?`,
	)
		.bind(
			name,
			formStatus(body.status, current.status === "disabled" ? "disabled" : "active"),
			JSON.stringify(settings),
			projectId,
			current.id,
		)
		.run();
	return c.json({ data: serializeForm(await signupForm(c.env.DB, projectId, String(current.id))) });
});

signupFormRoutes.delete("/audience/forms/:formId", async (c) => {
	const removed = await c.env.DB.prepare(
		"DELETE FROM marketing_signup_forms WHERE project_id = ? AND id = ? RETURNING id",
	)
		.bind(c.get("project").projectId, c.req.param("formId"))
		.first();
	if (!removed) throw failure("form_not_found", "Form not found", 404);
	return c.json({ data: { deleted: true } });
});

/** Ready-to-paste snippets. The server builds them so every channel shares one markup. */
signupFormRoutes.get("/audience/forms/:formId/embed", async (c) => {
	const projectId = c.get("project").projectId;
	const row = await signupForm(c.env.DB, projectId, c.req.param("formId"));
	const form = serializeForm(row);
	const definitions = await fieldDefinitions(c.env.DB, projectId);
	const url = formUrl(c.env, form.id);
	return c.json({
		data: {
			hosted_url: url,
			script_snippet: `<script src="${url}/embed.js" async></script>`,
			html_snippet: `${FORM_STYLE}\n${formMarkup(url, form.id, form.settings, definitions, false)}`,
		},
	});
});

// ---------------------------------------------------------------------------
// Public endpoints (reached through the API gateway without a Dashboard session)
// ---------------------------------------------------------------------------

export const publicSignupFormRoutes = registerRouter(new Hono<AudienceBindings>(), {
	service: "marketing",
	module: "forms.publicSignupFormRoutes",
	pluginId: "superboard-marketing",
	surface: "internal",
	access: "internal",
});

publicSignupFormRoutes.get("/public/v1/forms/:formId/embed.js", async (c) => {
	const form = await publicForm(c.env.DB, c.req.param("formId"));
	if (!form)
		return new Response("/* SuperBoard form unavailable */", {
			status: 404,
			headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" },
		});
	const definitions = await fieldDefinitions(c.env.DB, form.project_id);
	const url = formUrl(c.env, form.id);
	return new Response(embedScript(url, form, definitions), {
		headers: {
			"content-type": "text/javascript; charset=utf-8",
			"cache-control": "public, max-age=300",
			"access-control-allow-origin": "*",
		},
	});
});

publicSignupFormRoutes.get("/public/v1/forms/:formId", async (c) => {
	const form = await publicForm(c.env.DB, c.req.param("formId"));
	const locale = form?.settings.locale ?? requestLocale(null, c.req.header("accept-language"));
	if (!form)
		return page(
			locale,
			copy[locale].unavailable,
			`<p>${escapeHtml(copy[locale].unavailable)}</p>`,
			404,
		);
	const [definitions, brand] = await Promise.all([
		fieldDefinitions(c.env.DB, form.project_id),
		readBrandKit(c.env.DB, form.project_id).catch(() => null),
	]);
	const url = formUrl(c.env, form.id);
	const body = `<h1>${escapeHtml(form.settings.title)}</h1>${form.settings.description ? `<p>${escapeHtml(form.settings.description)}</p>` : ""}${formMarkup(url, form.id, form.settings, definitions, false)}`;
	return page(form.settings.locale, form.settings.title, body, 200, brand?.colors.accent);
});

publicSignupFormRoutes.post("/public/v1/forms/:formId", async (c) => {
	const form = await publicForm(c.env.DB, c.req.param("formId"));
	const locale = form?.settings.locale ?? requestLocale(null, c.req.header("accept-language"));
	const json = (c.req.header("accept") ?? "").includes("application/json");
	const values = await submittedValues(c.req.raw);
	const embedded = values._embed === "1";
	const respond = (
		status: ContentfulStatusCode,
		ok: boolean,
		message: string,
		confirmation = false,
	) => {
		if (json)
			return c.json(
				ok
					? { data: { ok, message, confirmation_required: confirmation } }
					: { error: { code: message, message } },
				status,
			);
		if (embedded)
			return new Response(
				`<!doctype html><meta charset="utf-8"><script>parent.postMessage(${safeJson({ type: "superboard-form", form: form?.id ?? "", ok, message })},"*")</script>`,
				{
					status,
					headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
				},
			);
		if (ok && form?.settings.redirect_url) return c.redirect(form.settings.redirect_url, 303);
		return page(
			locale,
			message,
			`<p class="notice${ok ? "" : " warning"}" role="status">${escapeHtml(message)}</p>`,
			status,
		);
	};
	if (!form) return respond(404, false, copy[locale].unavailable);
	const text = copy[form.settings.locale];
	// Bots fill every input; humans never see the honeypot. Pretend success.
	const trap = values[HONEYPOT];
	if (trap != null && (typeof trap === "object" || plainText(trap).trim()))
		return respond(200, true, form.settings.success_message || text.success);
	if (!(await withinRateLimit(c.env.DB, form.id, c.req.raw)))
		return respond(429, false, text.rateLimited);
	const address = plainText(values.email).trim().toLowerCase();
	if (address.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(address))
		return respond(422, false, text.invalidEmail);
	const definitions = await fieldDefinitions(c.env.DB, form.project_id);
	let name: string | null = null;
	const attributes: Record<string, unknown> = {};
	for (const field of form.settings.fields) {
		const raw = values[field.key === "name" ? "name" : `f_${field.key}`];
		const empty = raw === undefined || (typeof raw !== "object" && plainText(raw).trim() === "");
		if (empty) {
			if (field.required) return respond(422, false, text.missing);
			continue;
		}
		if (field.key === "name") {
			name = plainText(raw).trim().slice(0, 255);
			continue;
		}
		const definition = definitions.find((item) => item.key === field.key);
		if (!definition) continue;
		const result = coerceFieldValue(definition, raw);
		if ("error" in result) return respond(422, false, text.invalidField);
		if ("value" in result) attributes[field.key] = result.value;
	}
	const outcome = await subscribeFromForm(c.env, form, {
		email: address,
		name,
		attributes,
		locale: requestLocale(null, c.req.header("accept-language")),
	});
	return respond(
		200,
		true,
		outcome.confirmationRequired ? text.confirm : form.settings.success_message || text.success,
		outcome.confirmationRequired,
	);
});

type PublicForm = { id: string; project_id: number; settings: SignupFormSettings };

async function publicForm(db: D1Database, formId: string): Promise<PublicForm | null> {
	if (!/^[0-9a-f-]{36}$/u.test(formId)) return null;
	const row = await db
		.prepare(
			"SELECT id, project_id, settings_json FROM marketing_signup_forms WHERE id = ? AND status = 'active'",
		)
		.bind(formId)
		.first<{ id: string; project_id: number; settings_json: string }>();
	return row
		? {
				id: row.id,
				project_id: Number(row.project_id),
				settings: {
					...defaultSettings("en"),
					...parseStoredJson<Partial<SignupFormSettings>>(row.settings_json, {}),
				},
			}
		: null;
}

async function submittedValues(request: Request): Promise<Record<string, unknown>> {
	const type = request.headers.get("content-type") ?? "";
	if (Number(request.headers.get("content-length") || 0) > 32_000) return {};
	try {
		if (type.includes("application/json")) return await readJsonObject(request, 32_000);
		const data = await request.formData();
		const values: Record<string, unknown> = {};
		for (const [key, value] of data.entries())
			if (typeof value === "string" && key.length <= 80) values[key] = value.slice(0, 2000);
		return values;
	} catch {
		return {};
	}
}

/** Fixed window per form and hashed client address; old windows are pruned lazily. */
async function withinRateLimit(db: D1Database, formId: string, request: Request) {
	const client =
		request.headers.get("cf-connecting-ip") ||
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
		"unknown";
	const now = Date.now();
	const windowStart = new Date(now - (now % RATE_LIMIT_WINDOW_MS)).toISOString();
	const row = await db
		.prepare(
			`INSERT INTO marketing_form_rate_limits (form_id, client_hash, window_start, attempts) VALUES (?, ?, ?, 1)
       ON CONFLICT(form_id, client_hash, window_start) DO UPDATE SET attempts = attempts + 1
       RETURNING attempts`,
		)
		.bind(formId, await sha256(`${formId}:${client}`), windowStart)
		.first<{ attempts: number }>();
	// Prune old windows on about one submission in twenty.
	if ((crypto.getRandomValues(new Uint8Array(1))[0] ?? 0) < 13)
		await db
			.prepare("DELETE FROM marketing_form_rate_limits WHERE window_start < ?")
			.bind(new Date(now - 24 * 60 * 60 * 1000).toISOString())
			.run();
	return Number(row?.attempts || 0) <= RATE_LIMIT_ATTEMPTS;
}

/**
 * Creates or updates the contact behind a submission. New addresses and any
 * address that previously left (unsubscribed, revoked, pending) must confirm by
 * email when the form or one of its lists uses double opt-in; returning
 * contacts who left always confirm. Blocked or bounced addresses are ignored
 * silently so the form never reveals who is on the list.
 */
async function subscribeFromForm(
	env: Env,
	form: PublicForm,
	input: {
		email: string;
		name: string | null;
		attributes: Record<string, unknown>;
		locale: string;
	},
) {
	const projectId = form.project_id;
	const [existing, suppression, doubleLists] = await Promise.all([
		env.DB.prepare(
			"SELECT id, status, consent_status, attributes_json FROM subscribers WHERE project_id = ? AND email = ?",
		)
			.bind(projectId, input.email)
			.first<{ id: string; status: string; consent_status: string; attributes_json: string }>(),
		env.DB.prepare("SELECT reason FROM suppressions WHERE project_id = ? AND email = ?")
			.bind(projectId, input.email)
			.first<{ reason: string }>(),
		doubleOptInListIds(env.DB, projectId, form.settings.list_ids),
	]);
	if (existing?.status === "blocklisted" || (suppression && suppression.reason !== "unsubscribe"))
		return { confirmationRequired: false };
	const wantsConfirmation = form.settings.double_opt_in || doubleLists.length > 0;
	const active =
		existing?.status === "enabled" && existing.consent_status === "confirmed" && !suppression;
	const confirmationRequired = existing ? !active : wantsConfirmation;
	const subscriberId = existing?.id ?? crypto.randomUUID();
	const statements: D1PreparedStatement[] = [];
	if (existing) {
		statements.push(
			env.DB.prepare(
				`UPDATE subscribers SET name = COALESCE(?, name), attributes_json = json_patch(attributes_json, ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND id = ?`,
			).bind(input.name, JSON.stringify(input.attributes), projectId, subscriberId),
		);
	} else {
		const now = new Date().toISOString();
		statements.push(
			env.DB.prepare(
				`INSERT INTO subscribers (id, project_id, email, name, status, attributes_json, consent_status,
           consent_source, consented_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'enabled', ?, ?, ?, ?, ?, ?)`,
			).bind(
				subscriberId,
				projectId,
				input.email,
				input.name,
				JSON.stringify({ locale: input.locale, ...input.attributes }),
				confirmationRequired ? "pending" : "confirmed",
				`form:${form.id}`.slice(0, 128),
				confirmationRequired ? null : now,
				now,
				now,
			),
		);
	}
	statements.push(
		...form.settings.list_ids.map((listId) =>
			env.DB.prepare(
				`INSERT INTO subscriber_list_memberships (project_id, subscriber_id, list_id, source)
         SELECT ?, ?, id, 'form' FROM subscriber_lists WHERE project_id = ? AND id = ?
         ON CONFLICT(project_id, subscriber_id, list_id) DO NOTHING`,
			).bind(projectId, subscriberId, projectId, listId),
		),
		env.DB.prepare(
			`UPDATE marketing_signup_forms SET submission_count = submission_count + 1 WHERE id = ? AND project_id = ?`,
		).bind(form.id, projectId),
		env.DB.prepare(
			`INSERT INTO audit_events (id, project_id, action, actor_id, request_id, payload_json)
       VALUES (?, ?, 'subscriber.form_submitted', 'subscriber', ?, ?)`,
		).bind(
			crypto.randomUUID(),
			projectId,
			crypto.randomUUID(),
			JSON.stringify({
				form_id: form.id,
				subscriber_id: subscriberId,
				confirmation_required: confirmationRequired,
			}),
		),
	);
	await env.DB.batch(statements);
	if (confirmationRequired) await queueDoubleOptIns(env, projectId, [subscriberId]);
	return { confirmationRequired };
}

async function signupForm(db: D1Database, projectId: number, id: string) {
	const row = await db
		.prepare("SELECT * FROM marketing_signup_forms WHERE project_id = ? AND id = ?")
		.bind(projectId, id)
		.first<Record<string, unknown>>();
	if (!row) throw failure("form_not_found", "Form not found", 404);
	return row;
}

async function ensureUniqueName(db: D1Database, projectId: number, name: string, exceptId = "") {
	const conflict = await db
		.prepare("SELECT id FROM marketing_signup_forms WHERE project_id = ? AND name = ? AND id != ?")
		.bind(projectId, name, exceptId)
		.first();
	if (conflict) throw failure("form_conflict", "A form with this name already exists", 409);
}

function serializeForm(row: Record<string, unknown>) {
	return {
		id: String(row.id),
		name: String(row.name),
		status: String(row.status),
		submission_count: Number(row.submission_count || 0),
		settings: {
			...defaultSettings("en"),
			...parseStoredJson<Partial<SignupFormSettings>>(row.settings_json, {}),
		},
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

function formStatus(value: unknown, fallback: "active" | "disabled") {
	if (value == null) return fallback;
	if (value !== "active" && value !== "disabled")
		throw failure("status_invalid", "status must be active or disabled");
	return value;
}

function defaultSettings(locale: unknown): SignupFormSettings {
	const language = locale === "fr" ? "fr" : "en";
	return {
		locale: language,
		title: copy[language].title,
		description: null,
		submit_label: copy[language].submit,
		fields: [{ key: "name", required: false }],
		list_ids: [],
		double_opt_in: true,
		success_message: null,
		redirect_url: null,
		popup: { enabled: false, delay_seconds: 5 },
	};
}

async function validateFormSettings(
	db: D1Database,
	projectId: number,
	body: Record<string, unknown>,
	current: SignupFormSettings,
): Promise<SignupFormSettings> {
	const source = body.settings === undefined ? body : jsonObject(body.settings, "settings");
	const settings: SignupFormSettings = { ...current };
	if (source.locale !== undefined) settings.locale = source.locale === "fr" ? "fr" : "en";
	if (source.title !== undefined) settings.title = text(source.title, "title", 120);
	if (source.description !== undefined)
		settings.description = optionalText(source.description, "description", 500);
	if (source.submit_label !== undefined)
		settings.submit_label = text(source.submit_label, "submit_label", 40);
	if (source.success_message !== undefined)
		settings.success_message = optionalText(source.success_message, "success_message", 500);
	if (source.double_opt_in !== undefined) settings.double_opt_in = source.double_opt_in === true;
	if (source.redirect_url !== undefined) {
		const url = optionalText(source.redirect_url, "redirect_url", 2048);
		if (url) {
			let parsed: URL;
			try {
				parsed = new URL(url);
			} catch {
				throw failure("redirect_url_invalid", "redirect_url must be an https address");
			}
			if (parsed.protocol !== "https:")
				throw failure("redirect_url_invalid", "redirect_url must be an https address");
		}
		settings.redirect_url = url;
	}
	if (source.popup !== undefined) {
		const popup = jsonObject(source.popup, "popup");
		const delay = Math.trunc(Number(popup.delay_seconds ?? current.popup.delay_seconds));
		if (!Number.isFinite(delay) || delay < 0 || delay > 120)
			throw failure("popup_invalid", "Popup delay must be between 0 and 120 seconds");
		settings.popup = { enabled: popup.enabled === true, delay_seconds: delay };
	}
	if (source.list_ids !== undefined) {
		const listIds = stringArray(source.list_ids, "list_ids", 10);
		if (listIds.length) {
			const owned = await db
				.prepare(
					`SELECT COUNT(*) total FROM subscriber_lists WHERE project_id = ? AND id IN (${listIds.map(() => "?").join(",")})`,
				)
				.bind(projectId, ...listIds)
				.first<{ total: number }>();
			if (Number(owned?.total || 0) !== listIds.length)
				throw failure("list_not_found", "List not found", 404);
		}
		settings.list_ids = listIds;
	}
	if (source.fields !== undefined) {
		if (!Array.isArray(source.fields) || source.fields.length > MAX_FORM_FIELDS)
			throw failure(
				"fields_invalid",
				`A form can ask for at most ${MAX_FORM_FIELDS} fields besides the email`,
			);
		const definitions = new Set((await fieldDefinitions(db, projectId)).map((item) => item.key));
		const seen = new Set<string>();
		settings.fields = source.fields.map((value) => {
			const item = jsonObject(value, "field");
			const key = text(item.key, "field_key", 64);
			if ((key !== "name" && !definitions.has(key)) || seen.has(key))
				throw failure("fields_invalid", `Unknown or duplicate field: ${key}`);
			seen.add(key);
			return { key, required: item.required === true };
		});
	}
	return settings;
}

function formUrl(env: Env, formId: string) {
	return `${env.PUBLIC_API_URL}/v1/communication/marketing/forms/${formId}`;
}

function page(locale: "en" | "fr", title: string, body: string, status: number, accent?: string) {
	return new Response(publicPage({ title, body, locale, accent }), {
		status,
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
			"referrer-policy": "no-referrer",
		},
	});
}

function safeJson(value: unknown) {
	return JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");
}

const FORM_STYLE = `<style>.sb-form{display:grid;gap:10px;max-width:420px;font:15px/1.4 system-ui,sans-serif}.sb-form label{display:grid;gap:4px}.sb-form label.sb-check{display:flex;align-items:center;gap:8px}.sb-form input:not([type=checkbox]),.sb-form select{padding:9px 11px;border:1px solid #d4d4d8;border-radius:8px;font:inherit}.sb-form button{padding:10px 14px;border:0;border-radius:8px;background:#18181b;color:#fff;font:inherit;cursor:pointer}.sb-form .sb-hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}</style>`;

function formMarkup(
	url: string,
	formId: string,
	settings: SignupFormSettings,
	definitions: FieldDefinition[],
	embedded: boolean,
) {
	const text = copy[settings.locale];
	const inputs = settings.fields
		.map((field) => {
			const required = field.required ? " required" : "";
			const mark = field.required ? " *" : "";
			if (field.key === "name")
				return `<label><span>${escapeHtml(text.name)}${mark}</span><input type="text" name="name" autocomplete="name" maxlength="255"${required}></label>`;
			const definition = definitions.find((item) => item.key === field.key);
			if (!definition) return "";
			const name = `f_${escapeHtml(definition.key)}`;
			const label = `${escapeHtml(definition.label)}${mark}`;
			switch (definition.field_type) {
				case "boolean":
					return `<label class="sb-check"><input type="checkbox" name="${name}" value="true"${required}><span>${label}</span></label>`;
				case "select":
					return `<label><span>${label}</span><select name="${name}"${required}><option value=""></option>${definition.options.map((option) => `<option>${escapeHtml(option)}</option>`).join("")}</select></label>`;
				case "number":
					return `<label><span>${label}</span><input type="number" step="any" name="${name}"${required}></label>`;
				case "date":
					return `<label><span>${label}</span><input type="date" name="${name}"${required}></label>`;
				case "text":
					return `<label><span>${label}</span><input type="text" name="${name}" maxlength="1000"${required}></label>`;
			}
		})
		.join("");
	return `<form class="sb-form" method="post" action="${escapeHtml(url)}" accept-charset="utf-8" data-superboard-form="${escapeHtml(formId)}">${embedded ? '<input type="hidden" name="_embed" value="1">' : ""}<label><span>${escapeHtml(text.email)} *</span><input type="email" name="email" autocomplete="email" maxlength="320" required></label>${inputs}<div class="sb-hp" aria-hidden="true"><label>Website<input type="text" name="${HONEYPOT}" tabindex="-1" autocomplete="off"></label></div><button type="submit">${escapeHtml(settings.submit_label)}</button></form>`;
}

/**
 * Tiny dependency-free loader. Inline mode renders the form where the script
 * tag sits; popup mode opens it after the configured delay once per session.
 * Submissions go to a hidden iframe and report back with postMessage, so no
 * CORS configuration is needed on the visitor's site.
 */
function embedScript(url: string, form: PublicForm, definitions: FieldDefinition[]) {
	const redirect = Boolean(form.settings.redirect_url);
	const markup = formMarkup(url, form.id, form.settings, definitions, !redirect);
	const config = {
		id: form.id,
		origin: new URL(url).origin,
		markup,
		style: FORM_STYLE,
		title: form.settings.title,
		description: form.settings.description,
		popup: form.settings.popup,
		redirect,
		close: copy[form.settings.locale].close,
	};
	return `(function(){var c=${safeJson(config)};var s=document.currentScript;var key="sb-form-"+c.id;
function mount(host){var w=document.createElement("div");w.innerHTML=c.style+(c.popup.enabled?"<h2 style=\\"margin:0 0 6px;font:600 20px system-ui\\"></h2><p style=\\"margin:0 0 12px\\"></p>":"")+c.markup;
if(c.popup.enabled){w.querySelector("h2").textContent=c.title;var d=w.querySelector("p");if(c.description){d.textContent=c.description}else{d.remove()}}
var f=w.querySelector("form");if(!c.redirect){var n="sb-frame-"+c.id+"-"+crypto.getRandomValues(new Uint32Array(1))[0].toString(36);var i=document.createElement("iframe");i.name=n;i.title="";i.style.display="none";w.appendChild(i);f.target=n;
window.addEventListener("message",function(e){if(e.origin!==c.origin||!e.data||e.data.type!=="superboard-form"||e.data.form!==c.id)return;var m=document.createElement("p");m.setAttribute("role","status");m.textContent=e.data.message;
if(e.data.ok){f.replaceWith(m)}else{var o=f.querySelector("[role=status]");if(o)o.remove();m.style.color="#b91c1c";f.prepend(m)}})}else{f.target="_top"}host.appendChild(w);return w}
if(!c.popup.enabled){var h=document.createElement("div");if(s&&s.parentNode){s.parentNode.insertBefore(h,s.nextSibling)}else{document.body.appendChild(h)}mount(h);return}
try{if(sessionStorage.getItem(key))return}catch(_){}
setTimeout(function(){var o=document.createElement("div");o.setAttribute("role","dialog");o.setAttribute("aria-modal","true");o.style.cssText="position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px";
var b=document.createElement("div");b.style.cssText="position:relative;background:#fff;color:#18181b;border-radius:12px;padding:24px;max-width:460px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.25)";
var x=document.createElement("button");x.type="button";x.setAttribute("aria-label",c.close);x.textContent="\\u00d7";x.style.cssText="position:absolute;top:8px;right:12px;border:0;background:none;font-size:24px;cursor:pointer;color:inherit";
function close(){o.remove();try{sessionStorage.setItem(key,"1")}catch(_){}}x.onclick=close;o.addEventListener("click",function(e){if(e.target===o)close()});document.addEventListener("keydown",function(e){if(e.key==="Escape")close()});
b.appendChild(x);mount(b);o.appendChild(b);document.body.appendChild(o);var first=b.querySelector("input[type=email]");if(first)first.focus()},Math.max(0,c.popup.delay_seconds)*1000)})();`;
}
