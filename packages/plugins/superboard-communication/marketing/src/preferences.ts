import { registerRouter } from "@superboard/contracts/route-registry";
import { Hono } from "hono";

import {
	escapeHtml,
	isFrench,
	isRecord,
	plainText,
	publicPage,
	requestLocale,
	type AudienceBindings,
} from "./audience-shared";
import { failure } from "./auth";
import { readBrandKit } from "./brand-kit.js";
import { queueDoubleOptIns } from "./optin";
import type { Env } from "./types";
import { parseStoredJson } from "./validation";

type PreferencePayload = { p: number; s: string };
type Notice = "unsubscribed" | "saved" | "resubscribed" | "confirmation_sent" | "not_allowed";

const copy = {
	en: {
		title: "Email preferences",
		intro: "Choose the emails you want to receive at",
		lists: "Newsletters",
		noLists: "There are no newsletters to choose from.",
		save: "Save preferences",
		unsubscribe: "Unsubscribe from all emails",
		resubscribe: "Resubscribe",
		unsubscribed: "You are unsubscribed. You will no longer receive marketing emails from us.",
		unsubscribedHint: "Unsubscribed by mistake? You can resubscribe at any time.",
		saved: "Your preferences have been saved.",
		resubscribed: "Welcome back! You are subscribed again.",
		confirmation_sent: "Check your inbox: we sent you an email to confirm your subscription.",
		not_allowed: "This address cannot be resubscribed from this page.",
		invalid: "This link is invalid or has expired.",
		manage: "Manage email preferences",
		unsubscribeLink: "Unsubscribe",
	},
	fr: {
		title: "Préférences e-mail",
		intro: "Choisissez les e-mails que vous souhaitez recevoir à l’adresse",
		lists: "Newsletters",
		noLists: "Aucune newsletter n’est proposée pour le moment.",
		save: "Enregistrer mes préférences",
		unsubscribe: "Me désabonner de tous les e-mails",
		resubscribe: "Me réabonner",
		unsubscribed: "Vous êtes désabonné. Vous ne recevrez plus nos e-mails marketing.",
		unsubscribedHint: "Désabonné par erreur ? Vous pouvez vous réabonner à tout moment.",
		saved: "Vos préférences ont été enregistrées.",
		resubscribed: "Bon retour parmi nous ! Votre abonnement est réactivé.",
		confirmation_sent:
			"Consultez votre boîte de réception : un e-mail de confirmation vous a été envoyé.",
		not_allowed: "Cette adresse ne peut pas être réabonnée depuis cette page.",
		invalid: "Ce lien est invalide ou a expiré.",
		manage: "Gérer mes préférences e-mail",
		unsubscribeLink: "Se désabonner",
	},
} as const;

export const preferenceCenterRoutes = registerRouter(new Hono<AudienceBindings>(), {
	service: "marketing",
	module: "preferences.preferenceCenterRoutes",
	pluginId: "superboard-marketing",
	surface: "internal",
	access: "internal",
});

preferenceCenterRoutes.get("/public/v1/preferences/:token", async (c) => {
	const payload = await verifyPreferenceToken(c.env, c.req.param("token"));
	if (!payload) return invalidPage(c.req.header("accept-language"));
	return htmlResponse(
		await renderPreferenceCenter(c.env, payload.p, payload.s, {
			acceptLanguage: c.req.header("accept-language"),
		}),
	);
});

preferenceCenterRoutes.post("/public/v1/preferences/:token", async (c) => {
	const payload = await verifyPreferenceToken(c.env, c.req.param("token"));
	if (!payload) return invalidPage(c.req.header("accept-language"));
	const form: Record<string, unknown> = await c.req.parseBody({ all: true }).catch(() => ({}));
	const action = form.action == null ? "save" : plainText(form.action);
	const selected = (Array.isArray(form.list) ? form.list : form.list ? [form.list] : [])
		.map(String)
		.slice(0, 100);
	const notice = await applyPreferenceAction(c.env, payload.p, payload.s, action, selected);
	return htmlResponse(
		await renderPreferenceCenter(c.env, payload.p, payload.s, {
			notice,
			acceptLanguage: c.req.header("accept-language"),
		}),
	);
});

function htmlResponse(html: string, status = 200) {
	return new Response(html, {
		status,
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
			"referrer-policy": "no-referrer",
			"x-frame-options": "DENY",
		},
	});
}

function invalidPage(acceptLanguage: string | undefined) {
	const locale = requestLocale(null, acceptLanguage);
	const text = copy[locale];
	return htmlResponse(
		publicPage({
			title: text.title,
			locale,
			body: `<h1>${escapeHtml(text.title)}</h1><p>${escapeHtml(text.invalid)}</p>`,
		}),
		404,
	);
}

async function applyPreferenceAction(
	env: Env,
	projectId: number,
	subscriberId: string,
	action: string,
	selectedLists: string[],
): Promise<Notice | undefined> {
	const subscriber = await env.DB.prepare(
		"SELECT id, email, status, consent_status FROM subscribers WHERE project_id = ? AND id = ?",
	)
		.bind(projectId, subscriberId)
		.first<{ id: string; email: string; status: string; consent_status: string }>();
	if (!subscriber) return undefined;
	const audit = (event: string, payload: Record<string, unknown> = {}) =>
		env.DB.prepare(
			`INSERT INTO audit_events (id, project_id, action, actor_id, request_id, payload_json)
       VALUES (?, ?, ?, 'subscriber', ?, ?)`,
		).bind(
			crypto.randomUUID(),
			projectId,
			event,
			crypto.randomUUID(),
			JSON.stringify({ subscriber_id: subscriberId, ...payload }),
		);
	if (action === "unsubscribe") {
		await env.DB.batch([
			env.DB.prepare(
				`UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND id = ? AND status = 'enabled'`,
			).bind(projectId, subscriberId),
			env.DB.prepare(
				`INSERT INTO suppressions (id, project_id, email, reason, source) VALUES (?, ?, ?, 'unsubscribe', 'preferences')
         ON CONFLICT(project_id, email) DO NOTHING`,
			).bind(crypto.randomUUID(), projectId, subscriber.email),
			audit("subscriber.preferences_unsubscribed"),
		]);
		return "unsubscribed";
	}
	if (action === "resubscribe") {
		const suppression = await env.DB.prepare(
			"SELECT reason FROM suppressions WHERE project_id = ? AND email = ?",
		)
			.bind(projectId, subscriber.email)
			.first<{ reason: string }>();
		// Bounces, complaints, privacy deletions and team blocks stay authoritative.
		if (
			subscriber.status === "blocklisted" ||
			(suppression && suppression.reason !== "unsubscribe")
		)
			return "not_allowed";
		if (subscriber.consent_status !== "confirmed") {
			await queueDoubleOptIns(env, projectId, [subscriberId]);
			await audit("subscriber.preferences_confirmation_requested").run();
			return "confirmation_sent";
		}
		await env.DB.batch([
			env.DB.prepare(
				`UPDATE subscribers SET status = 'enabled', unsubscribed_at = NULL,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND id = ?`,
			).bind(projectId, subscriberId),
			env.DB.prepare(
				"DELETE FROM suppressions WHERE project_id = ? AND email = ? AND reason = 'unsubscribe'",
			).bind(projectId, subscriber.email),
			audit("subscriber.preferences_resubscribed"),
		]);
		return "resubscribed";
	}
	const publicLists = await env.DB.prepare(
		"SELECT id FROM subscriber_lists WHERE project_id = ? AND visibility = 'public'",
	)
		.bind(projectId)
		.all<{ id: string }>();
	const allowed = new Set(publicLists.results.map((row) => row.id));
	const chosen = [...new Set(selectedLists.filter((id) => allowed.has(id)))];
	await env.DB.batch([
		env.DB.prepare(
			`DELETE FROM subscriber_list_memberships WHERE project_id = ? AND subscriber_id = ?
         AND list_id IN (SELECT id FROM subscriber_lists WHERE project_id = ? AND visibility = 'public')`,
		).bind(projectId, subscriberId, projectId),
		...chosen.map((listId) =>
			env.DB.prepare(
				`INSERT INTO subscriber_list_memberships (project_id, subscriber_id, list_id, source)
         VALUES (?, ?, ?, 'preferences') ON CONFLICT(project_id, subscriber_id, list_id) DO NOTHING`,
			).bind(projectId, subscriberId, listId),
		),
		audit("subscriber.preferences_updated", { list_ids: chosen }),
	]);
	return "saved";
}

/** Renders the hosted preference center for one contact. */
export async function renderPreferenceCenter(
	env: Env,
	projectId: number,
	subscriberId: string,
	options: { notice?: Notice; acceptLanguage?: string | null },
) {
	const subscriber = await env.DB.prepare(
		"SELECT id, email, status, attributes_json FROM subscribers WHERE project_id = ? AND id = ?",
	)
		.bind(projectId, subscriberId)
		.first<{ id: string; email: string; status: string; attributes_json: string }>();
	const attributes = parseStoredJson<Record<string, unknown>>(subscriber?.attributes_json, {});
	const locale = requestLocale(
		attributes.marketing_locale ?? attributes.locale ?? null,
		options.acceptLanguage,
	);
	const text = copy[locale];
	if (!subscriber)
		return publicPage({
			title: text.title,
			locale,
			body: `<h1>${escapeHtml(text.title)}</h1><p>${escapeHtml(text.invalid)}</p>`,
		});
	const [lists, brand] = await Promise.all([
		env.DB.prepare(
			`SELECT list.id, list.name, list.description,
         CASE WHEN membership.list_id IS NULL THEN 0 ELSE 1 END selected
       FROM subscriber_lists list
       LEFT JOIN subscriber_list_memberships membership
         ON membership.project_id = list.project_id AND membership.list_id = list.id AND membership.subscriber_id = ?
       WHERE list.project_id = ? AND list.visibility = 'public' ORDER BY list.name, list.id`,
		)
			.bind(subscriberId, projectId)
			.all<{ id: string; name: string; description: string | null; selected: number }>(),
		readBrandKit(env.DB, projectId).catch(() => null),
	]);
	const action = await preferencesUrl(env, projectId, subscriberId);
	const unsubscribed = subscriber.status !== "enabled";
	const notice =
		options.notice && options.notice !== "unsubscribed"
			? `<p class="notice${options.notice === "not_allowed" ? " warning" : ""}" role="status">${escapeHtml(text[options.notice])}</p>`
			: "";
	const status = unsubscribed
		? `<p class="notice warning" role="status">${escapeHtml(text.unsubscribed)}</p><p>${escapeHtml(text.unsubscribedHint)}</p>`
		: "";
	const logo = brand?.logo_url
		? `<p><img src="${escapeHtml(brand.logo_url)}" alt="${escapeHtml(brand.company_name ?? "")}" style="max-height:48px;max-width:200px"></p>`
		: brand?.company_name
			? `<p><strong>${escapeHtml(brand.company_name)}</strong></p>`
			: "";
	const listItems = lists.results.length
		? lists.results
				.map(
					(list) =>
						`<label><input type="checkbox" name="list" value="${escapeHtml(list.id)}"${Number(list.selected) ? " checked" : ""}><span>${escapeHtml(list.name)}${list.description ? `<small>${escapeHtml(list.description)}</small>` : ""}</span></label>`,
				)
				.join("")
		: `<p><small>${escapeHtml(text.noLists)}</small></p>`;
	const body = `${logo}<h1>${escapeHtml(text.title)}</h1>${status}${notice}
<p>${escapeHtml(text.intro)} <strong>${escapeHtml(subscriber.email)}</strong></p>
<form method="post" action="${escapeHtml(action)}">
<h2 style="font-size:1rem;margin:24px 0 4px">${escapeHtml(text.lists)}</h2>${listItems}
<div class="actions">${lists.results.length ? `<button type="submit" name="action" value="save">${escapeHtml(text.save)}</button>` : ""}
${unsubscribed ? `<button type="submit" name="action" value="resubscribe" class="secondary">${escapeHtml(text.resubscribe)}</button>` : `<button type="submit" name="action" value="unsubscribe" class="secondary">${escapeHtml(text.unsubscribe)}</button>`}</div>
</form>${brand?.footer_text || brand?.company_address ? `<p style="margin-top:32px"><small>${escapeHtml([brand.footer_text, brand.company_address].filter(Boolean).join(" · "))}</small></p>` : ""}`;
	return publicPage({ title: text.title, locale, body, accent: brand?.colors.accent });
}

/** Signed, non-expiring link to the preference center of one contact. */
export async function preferencesUrl(env: Env, projectId: number, subscriberId: string) {
	const encoded = base64Url(
		new TextEncoder().encode(JSON.stringify({ p: projectId, s: subscriberId })),
	);
	return `${env.PUBLIC_API_URL}/v1/communication/marketing/preferences/${encoded}.${await sign(env, encoded)}`;
}

async function verifyPreferenceToken(env: Env, value: string): Promise<PreferencePayload | null> {
	const [encoded, signature, extra] = String(value).split(".");
	if (!encoded || !signature || extra !== undefined || encoded.length > 1024) return null;
	if (!env.TRACKING_SIGNING_KEY)
		throw failure("tracking_unavailable", "Tracking signing is not configured", 503);
	const expected = await sign(env, encoded);
	if (!(await constantTimeEqual(expected, signature))) return null;
	try {
		const payload: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)));
		return isRecord(payload) &&
			typeof payload.p === "number" &&
			Number.isSafeInteger(payload.p) &&
			typeof payload.s === "string" &&
			payload.s
			? { ...payload, p: payload.p, s: payload.s }
			: null;
	} catch {
		return null;
	}
}

/**
 * Adds a compact "manage preferences" footer to marketing HTML. Inserted after
 * click instrumentation so preference visits never count as engagement.
 */
export function appendPreferenceFooter(
	html: string,
	links: {
		preferencesUrl: string;
		unsubscribeUrl: string;
		includeUnsubscribe: boolean;
		locale: unknown;
	},
) {
	const text = copy[isFrench(links.locale) ? "fr" : "en"];
	const footer = `<p style="margin:24px 0 0;text-align:center;font:12px/1.5 Arial,sans-serif;color:#71717a"><a href="${escapeHtml(links.preferencesUrl)}" style="color:#71717a">${escapeHtml(text.manage)}</a>${!links.includeUnsubscribe ? "" : ` · <a href="${escapeHtml(links.unsubscribeUrl)}" style="color:#71717a">${escapeHtml(text.unsubscribeLink)}</a>`}</p>`;
	const closing = html.search(/<\/body>/iu);
	return closing >= 0
		? `${html.slice(0, closing)}${footer}${html.slice(closing)}`
		: `${html}${footer}`;
}

export function preferenceFooterText(preferences: string, locale: unknown) {
	return `${copy[isFrench(locale) ? "fr" : "en"].manage}: ${preferences}`;
}

async function sign(env: Env, encoded: string) {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(env.TRACKING_SIGNING_KEY),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return base64Url(
		new Uint8Array(
			await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`preferences:${encoded}`)),
		),
	);
}

async function constantTimeEqual(left: string, right: string) {
	const digest = async (value: string) =>
		new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
	const [a, b] = await Promise.all([digest(left), digest(right)]);
	let difference = 0;
	for (let index = 0; index < a.length; index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
	return difference === 0;
}

function base64Url(bytes: Uint8Array) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecode(value: string) {
	if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid base64url");
	const padded = value
		.replace(/-/g, "+")
		.replace(/_/g, "/")
		.padEnd(Math.ceil(value.length / 4) * 4, "=");
	return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
