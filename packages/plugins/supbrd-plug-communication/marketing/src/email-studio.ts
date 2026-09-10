import {
	canonicalEmailLocale,
	createEmailDesign,
	emailPublicationIssues,
	prepareEmailDesign,
	renderEmailTranslation,
	resolveEmailMessage,
	type EmailDesign,
	type EmailRenderContext,
	type ResolvedEmail,
	type EmailPurpose,
	type EmailBlock,
} from "@superboard/contracts/email-studio";
import type { ProjectContext } from "@superboard/contracts/project-context";
import { isSafePublicHttpsUrl } from "@superboard/contracts/url-security";
import { Hono } from "hono";

import { failure } from "./auth.js";
import { freezeDeliveryMessage, recordTransportStatus } from "./delivery-records.js";
import { sendSmtpMessage } from "./email-service.js";
import { translateEmail, type TranslationProvider } from "./email-translation.js";
import { decryptJson, encryptJson } from "./secrets.js";
import { deliverySenders } from "./sender-profiles.js";
import { studioDeliveryRoutes, studioDeliveryStatistics } from "./studio-deliveries.js";
import type { Env } from "./types.js";
import type { SmtpPublicConfig, SmtpSecretConfig } from "./types.js";
import { jsonObject, readJsonObject, text } from "./validation.js";
import { email, parseStoredJson } from "./validation.js";

type StudioDocument = { revision: number; document: EmailDesign };
type StudioRow = { revision: number; document_json: string };
export async function getPublishedEmailTemplate(
	db: D1Database,
	projectId: number,
	id: string,
): Promise<StudioDocument | null> {
	const row = await db
		.prepare(
			"SELECT revision,document_json FROM email_studio_published WHERE project_id=? AND template_id=?",
		)
		.bind(projectId, id)
		.first<StudioRow>();
	return row
		? { revision: row.revision, document: JSON.parse(row.document_json) as EmailDesign }
		: null;
}

export async function getEmailStudioDocument(
	db: D1Database,
	projectId: number,
	resourceId: string,
	type = "template",
): Promise<StudioDocument | null> {
	const row = await db
		.prepare(
			"SELECT revision, document_json FROM email_studio_documents WHERE project_id = ? AND resource_type = ? AND resource_id = ?",
		)
		.bind(projectId, type, resourceId)
		.first<StudioRow>();
	return row
		? { revision: row.revision, document: JSON.parse(row.document_json) as EmailDesign }
		: null;
}

export async function saveEmailStudioTemplate(
	db: D1Database,
	projectId: number,
	id: string,
	body: Record<string, unknown>,
	statement: D1PreparedStatement,
) {
	if (body.studio_document === undefined) {
		await statement.run();
		return;
	}
	const current = await getEmailStudioDocument(db, projectId, id);
	if (body.expected_revision !== (current?.revision ?? 0))
		throw failure(
			"EMAIL_REVISION_CONFLICT",
			"This template has changed. Reload it before saving.",
			409,
		);
	let document: EmailDesign;
	try {
		document = prepareEmailDesign(body.studio_document, current?.document);
	} catch {
		throw failure("EMAIL_DESIGN_INVALID", "The email design is invalid.");
	}
	const revision = (current?.revision ?? 0) + 1;
	const serialized = JSON.stringify(document);
	const rendered = renderEmailTranslation(document, document.source_locale);
	try {
		await db.batch([
			db
				.prepare(
					"INSERT INTO email_studio_versions (project_id, resource_type, resource_id, revision, document_json) VALUES (?, 'template', ?, ?, ?)",
				)
				.bind(projectId, id, revision, serialized),
			statement,
			db
				.prepare(
					"UPDATE email_templates SET subject=?,content_html=?,content_text=? WHERE project_id=? AND id=?",
				)
				.bind(
					document.locales[document.source_locale]!.subject,
					rendered.html,
					rendered.text,
					projectId,
					id,
				),
			db
				.prepare(
					"INSERT INTO email_studio_documents (project_id, resource_type, resource_id, revision, document_json) VALUES (?, 'template', ?, ?, ?) ON CONFLICT(project_id, resource_type, resource_id) DO UPDATE SET revision = excluded.revision, document_json = excluded.document_json, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
				)
				.bind(projectId, id, revision, serialized),
		]);
	} catch (error) {
		if (String(error).includes("email_studio_versions"))
			throw failure(
				"EMAIL_REVISION_CONFLICT",
				"This template has changed. Reload it before saving.",
				409,
			);
		throw error;
	}
}

export async function snapshotEmailCampaign(
	db: D1Database,
	projectId: number,
	campaignId: string,
	templateId: string | null,
	snapshot?: StudioDocument,
) {
	if (!templateId) return;
	if (await getEmailStudioDocument(db, projectId, campaignId, "campaign")) return;
	const studio = snapshot ?? (await getEmailStudioDocument(db, projectId, templateId));
	if (!studio) return;
	const issues = emailPublicationIssues(studio.document);
	if (issues.length)
		throw failure(
			"EMAIL_TRANSLATIONS_NOT_READY",
			"Approve the fallback translation before scheduling this message.",
			422,
			{ issues },
		);
	await db
		.prepare(
			"INSERT INTO email_studio_documents (project_id, resource_type, resource_id, revision, document_json) VALUES (?, 'campaign', ?, ?, ?) ON CONFLICT(project_id, resource_type, resource_id) DO UPDATE SET revision=excluded.revision, document_json=excluded.document_json",
		)
		.bind(projectId, campaignId, studio.revision, JSON.stringify(studio.document))
		.run();
}

export async function resolveStoredEmail(
	db: D1Database,
	projectId: number,
	resourceId: string,
	deliveryId: string,
	context: EmailRenderContext,
	type = "campaign",
): Promise<ResolvedEmail | null> {
	const saved = await db
		.prepare("SELECT * FROM email_studio_deliveries WHERE project_id=? AND delivery_id=?")
		.bind(projectId, deliveryId)
		.first<{
			purpose: EmailPurpose;
			locale: string | null;
			requested_locale: string | null;
			reason: ResolvedEmail["reason"];
			subject: string;
			content_html: string;
			content_text: string;
		}>();
	if (saved)
		return saved.locale
			? {
					status: "ready",
					purpose: saved.purpose,
					locale: saved.locale,
					requested_locale: saved.requested_locale,
					reason: saved.reason as "exact" | "base_language" | "fallback",
					subject: saved.subject,
					html: saved.content_html,
					text: saved.content_text,
					missing_variables: [],
				}
			: {
					status: "skipped",
					purpose: saved.purpose,
					requested_locale: saved.requested_locale,
					reason: "translation_unavailable",
				};
	let studio = await getEmailStudioDocument(db, projectId, resourceId, type);
	if (!studio) return null;
	if (type === "template") {
		studio = await getPublishedEmailTemplate(db, projectId, resourceId);
		if (!studio)
			throw failure(
				"EMAIL_TEMPLATE_NOT_PUBLISHED",
				"Publish this email template before sending.",
				409,
			);
	}
	const resolved = resolveEmailMessage(studio.document, context);
	if (resolved.status === "ready" && resolved.missing_variables.length)
		throw failure("EMAIL_VARIABLES_MISSING", "Required email variables are missing.", 422, {
			variables: resolved.missing_variables,
		});
	await db
		.prepare(
			"INSERT INTO email_studio_deliveries (project_id, delivery_id, resource_id, purpose, locale, requested_locale, reason, revision, subject, content_html, content_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, delivery_id) DO NOTHING",
		)
		.bind(
			projectId,
			deliveryId,
			resourceId,
			studio.document.purpose,
			resolved.status === "ready" ? resolved.locale : null,
			resolved.requested_locale,
			resolved.reason,
			studio.revision,
			resolved.status === "ready" ? resolved.subject : null,
			resolved.status === "ready" ? resolved.html : null,
			resolved.status === "ready" ? resolved.text : null,
		)
		.run();
	return resolved;
}

export async function claimEmailFrequency(
	db: D1Database,
	projectId: number,
	deliveryId: string,
	recipient: string,
): Promise<boolean> {
	const message = await db
		.prepare("SELECT purpose FROM email_studio_deliveries WHERE project_id=? AND delivery_id=?")
		.bind(projectId, deliveryId)
		.first<{ purpose: string }>();
	if (!message || !["campaign", "lifecycle"].includes(message.purpose)) return true;
	const settings = await db
		.prepare("SELECT settings_json FROM email_studio_settings WHERE project_id=?")
		.bind(projectId)
		.first<{ settings_json: string }>();
	const hours = settings
		? Number(
				parseStoredJson<Record<string, unknown>>(settings.settings_json, {})
					.marketing_frequency_hours ?? 24,
			)
		: 24;
	if (hours === 0) return true;
	const now = new Date().toISOString();
	const until = new Date(Date.now() + hours * 3600000).toISOString();
	const result = await db
		.prepare(
			"INSERT INTO email_studio_frequency (project_id,recipient_email,delivery_id,next_allowed_at) VALUES (?,?,?,?) ON CONFLICT(project_id,recipient_email) DO UPDATE SET delivery_id=excluded.delivery_id,next_allowed_at=excluded.next_allowed_at WHERE email_studio_frequency.next_allowed_at<=? OR email_studio_frequency.delivery_id=excluded.delivery_id RETURNING delivery_id",
		)
		.bind(projectId, recipient.toLowerCase(), deliveryId, until, now)
		.first();
	return result !== null;
}

export const emailStudioRoutes = new Hono<{
	Bindings: Env;
	Variables: { project: ProjectContext };
}>();
emailStudioRoutes.use("*", async (c, next) => {
	if (!["owner", "admin"].includes(c.get("project").role.toLowerCase()))
		throw failure("role_insufficient", "Owner or admin access is required.", 403);
	await next();
});
emailStudioRoutes.get("/templates/:id/published", async (c) =>
	c.json({
		data: await getPublishedEmailTemplate(c.env.DB, c.get("project").projectId, c.req.param("id")),
	}),
);
emailStudioRoutes.post("/templates/:id/publish", async (c) => {
	const projectId = c.get("project").projectId;
	const id = c.req.param("id");
	const body = await readJsonObject(c.req.raw);
	const current = await getEmailStudioDocument(c.env.DB, projectId, id);
	if (!current) throw failure("template_not_found", "Template not found.", 404);
	if (body.expected_revision !== current.revision)
		throw failure("EMAIL_REVISION_CONFLICT", "Save the latest changes before publishing.", 409);
	const issues = emailPublicationIssues(current.document);
	if (issues.length)
		throw failure(
			"EMAIL_TRANSLATIONS_NOT_READY",
			"Approve the fallback translation before publishing.",
			422,
			{ issues },
		);
	await c.env.DB.prepare(
		"INSERT INTO email_studio_published (project_id,template_id,revision,document_json) VALUES (?,?,?,?) ON CONFLICT(project_id,template_id) DO UPDATE SET revision=excluded.revision,document_json=excluded.document_json,published_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
	)
		.bind(projectId, id, current.revision, JSON.stringify(current.document))
		.run();
	return c.json({ data: { published_revision: current.revision } });
});
emailStudioRoutes.get("/blocks", async (c) => {
	const rows = await c.env.DB.prepare(
		"SELECT resource_id,revision,document_json FROM email_studio_documents WHERE project_id=? AND resource_type='block' ORDER BY updated_at DESC LIMIT 100",
	)
		.bind(c.get("project").projectId)
		.all<StudioRow & { resource_id: string }>();
	return c.json({
		data: rows.results.map((row) => ({
			id: row.resource_id,
			revision: row.revision,
			document: JSON.parse(row.document_json) as EmailDesign,
		})),
	});
});
emailStudioRoutes.post("/blocks", async (c) => {
	const body = await readJsonObject(c.req.raw);
	const locale = canonicalEmailLocale(body.locale) ?? "en";
	const initial = createEmailDesign(locale);
	initial.locales[locale]!.subject = text(body.name, "name");
	initial.locales[locale]!.blocks = [body.block as EmailBlock];
	let document: EmailDesign;
	try {
		document = prepareEmailDesign(initial);
	} catch {
		throw failure("EMAIL_DESIGN_INVALID", "The shared block is invalid.");
	}
	const id = crypto.randomUUID();
	const json = JSON.stringify(document);
	const projectId = c.get("project").projectId;
	await c.env.DB.batch([
		c.env.DB.prepare(
			"INSERT INTO email_studio_documents (project_id,resource_type,resource_id,revision,document_json) VALUES (?,'block',?,1,?)",
		).bind(projectId, id, json),
		c.env.DB.prepare(
			"INSERT INTO email_studio_versions (project_id,resource_type,resource_id,revision,document_json) VALUES (?,'block',?,1,?)",
		).bind(projectId, id, json),
	]);
	return c.json({ data: { id, revision: 1, document } }, 201);
});
emailStudioRoutes.put("/blocks/:id", async (c) => {
	const projectId = c.get("project").projectId;
	const id = c.req.param("id");
	const body = await readJsonObject(c.req.raw);
	const current = await getEmailStudioDocument(c.env.DB, projectId, id, "block");
	if (!current) throw failure("EMAIL_BLOCK_NOT_FOUND", "Shared block not found.", 404);
	if (body.expected_revision !== current.revision)
		throw failure("EMAIL_REVISION_CONFLICT", "This block has changed.", 409);
	let document: EmailDesign;
	try {
		document = prepareEmailDesign(body.document, current.document);
	} catch {
		throw failure("EMAIL_DESIGN_INVALID", "The shared block is invalid.");
	}
	const revision = current.revision + 1;
	const json = JSON.stringify(document);
	try {
		await c.env.DB.batch([
			c.env.DB.prepare(
				"INSERT INTO email_studio_versions (project_id,resource_type,resource_id,revision,document_json) VALUES (?,'block',?,?,?)",
			).bind(projectId, id, revision, json),
			c.env.DB.prepare(
				"UPDATE email_studio_documents SET document_json=?,revision=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=? AND resource_type='block' AND resource_id=? AND revision=?",
			).bind(json, revision, projectId, id, current.revision),
		]);
	} catch {
		throw failure("EMAIL_REVISION_CONFLICT", "This block has changed.", 409);
	}
	return c.json({ data: { id, revision, document } });
});
emailStudioRoutes.get("/blocks/:id/usage", async (c) => {
	const id = c.req.param("id");
	const rows = await c.env.DB.prepare(
		"SELECT t.id,t.name FROM email_templates t JOIN email_studio_documents s ON s.project_id=t.project_id AND s.resource_type='template' AND s.resource_id=t.id WHERE t.project_id=? AND instr(s.document_json,?)>0 ORDER BY t.name LIMIT 100",
	)
		.bind(c.get("project").projectId, JSON.stringify(id))
		.all<{ id: string; name: string }>();
	return c.json({ data: rows.results });
});
emailStudioRoutes.post("/blocks/:id/apply", async (c) => {
	const projectId = c.get("project").projectId;
	const id = c.req.param("id");
	const body = await readJsonObject(c.req.raw);
	const shared = await getEmailStudioDocument(c.env.DB, projectId, id, "block");
	if (!shared) throw failure("EMAIL_BLOCK_NOT_FOUND", "Shared block not found.", 404);
	const ids = Array.isArray(body.template_ids)
		? body.template_ids.filter((value): value is string => typeof value === "string")
		: [];
	if (!ids.length || ids.length > 25)
		throw failure("EMAIL_TEMPLATES_INVALID", "Choose between 1 and 25 templates.");
	const updated: string[] = [];
	const conflicts: string[] = [];
	for (const templateId of new Set(ids)) {
		const current = await getEmailStudioDocument(c.env.DB, projectId, templateId);
		if (!current) continue;
		const document = structuredClone(current.document);
		for (const [locale, translation] of Object.entries(document.locales)) {
			const source =
				shared.document.locales[locale] ??
				shared.document.locales[locale.split("-")[0]!] ??
				shared.document.locales[shared.document.fallback_locale];
			const replacement = source?.blocks[0];
			if (!replacement) continue;
			const replace = (blocks: EmailBlock[]): EmailBlock[] =>
				blocks.map((block) =>
					block.shared_id === id
						? { ...structuredClone(replacement), id: block.id, shared_id: id }
						: block.columns
							? { ...block, columns: block.columns.map(replace) }
							: block,
				);
			translation.blocks = replace(translation.blocks);
		}
		try {
			await saveEmailStudioTemplate(
				c.env.DB,
				projectId,
				templateId,
				{ studio_document: document, expected_revision: current.revision },
				c.env.DB.prepare(
					"UPDATE email_templates SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=? AND id=?",
				).bind(projectId, templateId),
			);
			updated.push(templateId);
		} catch {
			conflicts.push(templateId);
		}
	}
	return c.json({ data: { updated, conflicts } });
});
emailStudioRoutes.get("/templates/:id/history", async (c) => {
	const rows = await c.env.DB.prepare(
		"SELECT revision, document_json, created_at FROM email_studio_versions WHERE project_id=? AND resource_type='template' AND resource_id=? ORDER BY revision DESC LIMIT 50",
	)
		.bind(c.get("project").projectId, c.req.param("id"))
		.all<StudioRow & { created_at: string }>();
	return c.json({
		data: rows.results.map((row) => ({
			revision: row.revision,
			document: JSON.parse(row.document_json) as EmailDesign,
			created_at: row.created_at,
		})),
	});
});
emailStudioRoutes.post("/preview", async (c) => {
	const body = await readJsonObject(c.req.raw);
	let document: EmailDesign;
	try {
		document = prepareEmailDesign(body.document);
	} catch {
		throw failure("EMAIL_DESIGN_INVALID", "The email design is invalid.");
	}
	const context = jsonObject(body.context, "context") as EmailRenderContext;
	const locale = canonicalEmailLocale(body.locale);
	if (locale && !document.locales[locale])
		throw failure("EMAIL_TRANSLATION_MISSING", "This translation does not exist.");
	return c.json({
		data: locale
			? renderEmailTranslation(document, locale, context)
			: resolveEmailMessage(document, context),
	});
});
emailStudioRoutes.post("/templates/:id/test", async (c) => {
	const projectId = c.get("project").projectId;
	const studio = await getEmailStudioDocument(c.env.DB, projectId, c.req.param("id"));
	if (!studio) throw failure("template_not_found", "Template not found.", 404);
	const body = await readJsonObject(c.req.raw);
	const recipient = email(body.recipient);
	const locale = canonicalEmailLocale(body.locale) ?? studio.document.source_locale;
	if (!studio.document.locales[locale])
		throw failure("EMAIL_TRANSLATION_MISSING", "This translation does not exist.");
	const context = jsonObject(body.context, "context") as EmailRenderContext;
	const rendered = renderEmailTranslation(studio.document, locale, context);
	if (rendered.missing_variables.length)
		throw failure("EMAIL_VARIABLES_MISSING", "Required email variables are missing.", 422, {
			variables: rendered.missing_variables,
		});
	const profile = (
		await deliverySenders(
			c.env,
			projectId,
			typeof body.profile_id === "string" ? body.profile_id : null,
		)
	)[0];
	if (!profile) throw failure("EMAIL_SENDER_REQUIRED", "Configure an email sender first.", 409);
	const id = crypto.randomUUID();
	const receipt = await sendSmtpMessage(c.env, {
		idempotencyKey: `studio.test:${projectId}:${c.req.header("Idempotency-Key")}`,
		projectId,
		referenceId: id,
		profileId: profile.id,
		managed: profile.managed,
		publicConfig: JSON.parse(profile.public_config_json) as SmtpPublicConfig,
		secret:
			profile.managed || c.env.EMAIL_PROVIDER === "aws-ses"
				? { password: null }
				: await decryptJson<SmtpSecretConfig>(c.env.SMTP_ENCRYPTION_KEY, profile.encrypted_config),
		message: await freezeDeliveryMessage(
			c.env.DB,
			projectId,
			id,
			async () => ({
				to: recipient,
				subject: rendered.subject,
				html: rendered.html,
				text: rendered.text,
			}),
			"test",
			locale,
		),
	});
	await recordTransportStatus(c.env.DB, projectId, id, "sent", receipt.messageId);
	return c.json({ data: { status: receipt.status, id: receipt.id } });
});
emailStudioRoutes.get("/campaigns/:id/preflight", async (c) => {
	const projectId = c.get("project").projectId;
	const campaign = await c.env.DB.prepare("SELECT * FROM campaigns WHERE project_id=? AND id=?")
		.bind(projectId, c.req.param("id"))
		.first<{
			template_id: string | null;
			smtp_profile_id: string | null;
			list_ids_json: string;
			segment_ids_json: string;
		}>();
	if (!campaign) throw failure("campaign_not_found", "Campaign not found.", 404);
	const studio = campaign.template_id
		? await getEmailStudioDocument(c.env.DB, projectId, campaign.template_id)
		: null;
	const issues = studio ? emailPublicationIssues(studio.document) : [];
	if (
		!(
			await deliverySenders(
				c.env,
				projectId,
				typeof campaign.smtp_profile_id === "string" ? campaign.smtp_profile_id : null,
			)
		).length
	)
		issues.push("EMAIL_SENDER_REQUIRED");
	const target: string[] = [];
	const values: (string | number)[] = [projectId];
	const lists = parseStoredJson<string[]>(campaign.list_ids_json, []);
	const segments = parseStoredJson<string[]>(campaign.segment_ids_json, []);
	if (lists.length) {
		target.push(
			`EXISTS (SELECT 1 FROM subscriber_list_memberships m WHERE m.project_id=s.project_id AND m.subscriber_id=s.id AND m.list_id IN (${lists.map(() => "?").join(",")}))`,
		);
		values.push(...lists);
	}
	if (segments.length) {
		target.push(
			`EXISTS (SELECT 1 FROM segment_memberships m WHERE m.project_id=s.project_id AND m.subscriber_id=s.id AND m.segment_id IN (${segments.map(() => "?").join(",")}))`,
		);
		values.push(...segments);
	}
	let cursor = "";
	let eligible = 0;
	let excluded = 0;
	const languages = new Map<string, { locale: string; count: number; fallback: number }>();
	while (true) {
		const rows = await c.env.DB.prepare(
			`SELECT s.id,s.email,s.name,s.attributes_json,s.status,s.consent_status,EXISTS(SELECT 1 FROM suppressions p WHERE p.project_id=s.project_id AND p.email=s.email) AS suppressed FROM subscribers s WHERE s.project_id=? ${target.length ? `AND (${target.join(" OR ")})` : ""} AND s.id>? ORDER BY s.id LIMIT 250`,
		)
			.bind(...values, cursor)
			.all<{
				id: string;
				email: string;
				name: string;
				attributes_json: string;
				status: string;
				consent_status: string;
				suppressed: number;
			}>();
		for (const row of rows.results) {
			if (row.status !== "enabled" || row.consent_status !== "confirmed" || row.suppressed) {
				excluded++;
				continue;
			}
			const resolved = studio
				? resolveEmailMessage(studio.document, {
						unsubscribe_url: "https://preview.invalid/unsubscribe",
						profile: {
							...parseStoredJson<Record<string, unknown>>(row.attributes_json, {}),
							name: row.name,
							email: row.email,
						},
					})
				: null;
			if (resolved?.status === "skipped") {
				excluded++;
				continue;
			}
			if (
				resolved?.status === "ready" &&
				resolved.missing_variables.length &&
				!issues.includes("EMAIL_VARIABLES_MISSING")
			)
				issues.push("EMAIL_VARIABLES_MISSING");
			eligible++;
			const locale = resolved?.status === "ready" ? resolved.locale : "legacy";
			const entry = languages.get(locale) ?? { locale, count: 0, fallback: 0 };
			entry.count++;
			if (resolved?.status === "ready" && resolved.reason === "fallback") entry.fallback++;
			languages.set(locale, entry);
		}
		if (rows.results.length < 250) break;
		cursor = rows.results.at(-1)!.id;
	}
	return c.json({ data: { eligible, excluded, languages: [...languages.values()], issues } });
});
emailStudioRoutes.route("/deliveries", studioDeliveryRoutes);
emailStudioRoutes.get("/statistics", async (c) =>
	c.json({
		data: await studioDeliveryStatistics(
			c.env.DB,
			c.get("project").projectId,
			new URL(c.req.url).searchParams,
		),
	}),
);
emailStudioRoutes.get("/settings", async (c) => {
	const row = await c.env.DB.prepare(
		"SELECT settings_json FROM email_studio_settings WHERE project_id=?",
	)
		.bind(c.get("project").projectId)
		.first<{ settings_json: string }>();
	return c.json({
		data: publicStudioSettings(
			row
				? JSON.parse(row.settings_json)
				: {
						locales: ["fr", "en"],
						fallback_locale: "en",
						marketing_frequency_hours: 24,
						glossary: [],
					},
		),
	});
});
emailStudioRoutes.put("/settings", async (c) => {
	const body = await readJsonObject(c.req.raw);
	const locales = Array.isArray(body.locales)
		? [...new Set(body.locales.map(canonicalEmailLocale))]
		: [];
	const fallback = canonicalEmailLocale(body.fallback_locale);
	if (
		!locales.length ||
		locales.length > 60 ||
		locales.includes(null) ||
		!fallback ||
		!locales.includes(fallback)
	)
		throw failure("EMAIL_LOCALES_INVALID", "Choose valid languages and a fallback language.");
	const hours = Number(body.marketing_frequency_hours ?? 24);
	if (!Number.isFinite(hours) || hours < 0 || hours > 720)
		throw failure("EMAIL_FREQUENCY_INVALID", "Choose a frequency between 0 and 720 hours.");
	const glossary = Array.isArray(body.glossary)
		? body.glossary
				.filter((term) => typeof term === "string" && term.trim())
				.slice(0, 200)
				.map((term) => text(term, "glossary", 200))
		: [];
	const currentRow = await c.env.DB.prepare(
		"SELECT settings_json FROM email_studio_settings WHERE project_id=?",
	)
		.bind(c.get("project").projectId)
		.first<{ settings_json: string }>();
	const current = currentRow
		? parseStoredJson<Record<string, unknown>>(currentRow.settings_json, {})
		: {};
	let provider = current.ai_provider;
	if (body.ai_provider === null) provider = null;
	else if (body.ai_provider !== undefined) {
		const input = jsonObject(body.ai_provider, "ai_provider", 12000);
		if (!isSafePublicHttpsUrl(input.url))
			throw failure("EMAIL_AI_URL_INVALID", "Use a public HTTPS endpoint.");
		const old =
			provider && typeof provider === "object" ? (provider as Record<string, unknown>) : {};
		const key = typeof input.api_key === "string" ? input.api_key.trim() : "";
		if (!key && old.url !== input.url)
			throw failure("EMAIL_AI_KEY_REQUIRED", "Enter a key for this provider.");
		provider = {
			url: String(input.url),
			model: text(input.model, "model", 128),
			encrypted_key: key
				? await encryptJson(c.env.SMTP_ENCRYPTION_KEY, { api_key: text(key, "api_key", 8192) })
				: old.encrypted_key,
		};
	}
	const settings = {
		locales,
		fallback_locale: fallback,
		marketing_frequency_hours: hours,
		glossary,
		ai_provider: provider ?? null,
	};
	await c.env.DB.prepare(
		"INSERT INTO email_studio_settings (project_id, settings_json) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET settings_json=excluded.settings_json",
	)
		.bind(c.get("project").projectId, JSON.stringify(settings))
		.run();
	return c.json({ data: publicStudioSettings(settings) });
});

function publicStudioSettings(value: Record<string, unknown>) {
	const provider =
		value.ai_provider && typeof value.ai_provider === "object"
			? (value.ai_provider as Record<string, unknown>)
			: null;
	return {
		locales: value.locales,
		fallback_locale: value.fallback_locale,
		marketing_frequency_hours: value.marketing_frequency_hours,
		glossary: value.glossary,
		ai_provider: provider
			? {
					url: provider.url,
					model: provider.model,
					configured: typeof provider.encrypted_key === "string",
				}
			: null,
	};
}
emailStudioRoutes.post("/templates/:id/translate", async (c) => {
	const projectId = c.get("project").projectId;
	const body = await readJsonObject(c.req.raw);
	const current = await getEmailStudioDocument(c.env.DB, projectId, c.req.param("id"));
	if (!current) throw failure("template_not_found", "Template not found.", 404);
	if (body.expected_revision !== current.revision)
		throw failure(
			"EMAIL_REVISION_CONFLICT",
			"The source changed. Save it before translating.",
			409,
		);
	const locale = canonicalEmailLocale(body.locale);
	if (!locale || locale === current.document.source_locale)
		throw failure("EMAIL_LOCALES_INVALID", "Choose a target language.");
	const row = await c.env.DB.prepare(
		"SELECT settings_json FROM email_studio_settings WHERE project_id=?",
	)
		.bind(projectId)
		.first<{ settings_json: string }>();
	const settings = row ? parseStoredJson<Record<string, unknown>>(row.settings_json, {}) : {};
	if (Array.isArray(settings.locales) && !settings.locales.includes(locale))
		throw failure("EMAIL_LOCALES_INVALID", "Enable the target language in project settings.");
	const provider = settings.ai_provider as
		| { url: string; model: string; encrypted_key: string }
		| undefined;
	if (!provider?.encrypted_key)
		throw failure(
			"EMAIL_AI_NOT_CONFIGURED",
			"Configure a translation provider in project settings.",
			409,
		);
	const secret = await decryptJson<Pick<TranslationProvider, "api_key">>(
		c.env.SMTP_ENCRYPTION_KEY,
		provider.encrypted_key,
	);
	const translation = await translateEmail(
		{ ...provider, ...secret },
		current.document,
		locale,
		Array.isArray(settings.glossary)
			? settings.glossary.filter((value): value is string => typeof value === "string")
			: [],
	);
	return c.json({ data: { locale, translation, source_revision: current.revision } });
});
