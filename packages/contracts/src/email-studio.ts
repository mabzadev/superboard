export const EMAIL_PURPOSES = [
	"authentication",
	"billing",
	"notification",
	"lifecycle",
	"campaign",
	"support",
	"operator",
] as const;
export type EmailPurpose = (typeof EMAIL_PURPOSES)[number];
export type EmailTranslationStatus = "draft" | "approved" | "needs_review";
export type EmailCondition = {
	field: string;
	operator: "equals" | "not_equals" | "exists";
	value?: string;
};
export type EmailBlock = {
	id: string;
	type: "heading" | "text" | "image" | "button" | "divider" | "spacer" | "columns";
	text?: string;
	url?: string;
	alt?: string;
	align?: "left" | "center" | "right";
	color?: string;
	background?: string;
	font_size?: number;
	padding?: number;
	columns?: EmailBlock[][];
	condition?: EmailCondition;
	shared_id?: string;
};
export type EmailTranslation = {
	subject: string;
	preheader: string;
	blocks: EmailBlock[];
	status: EmailTranslationStatus;
	source_revision: number;
};
export type EmailDesign = {
	schema_version: 1;
	purpose: EmailPurpose;
	source_locale: string;
	fallback_locale: string;
	missing_translation: "fallback" | "skip";
	source_revision: number;
	theme: {
		background: string;
		surface: string;
		text: string;
		accent: string;
		font: string;
		width: number;
	};
	locales: Record<string, EmailTranslation>;
};
export type EmailRenderContext = {
	profile?: Record<string, unknown>;
	event?: Record<string, unknown>;
	request_locale?: string;
	currency?: string;
	time_zone?: string;
	unsubscribe_url?: string;
};
export type ResolvedEmail =
	| {
			status: "ready";
			purpose: EmailPurpose;
			locale: string;
			requested_locale: string | null;
			reason: "exact" | "base_language" | "fallback";
			subject: string;
			html: string;
			text: string;
			missing_variables: string[];
	  }
	| {
			status: "skipped";
			purpose: EmailPurpose;
			reason: "translation_unavailable";
			requested_locale: string | null;
	  };

export function canonicalEmailLocale(value: unknown): string | null {
	if (typeof value !== "string" || value.length > 64) return null;
	try {
		return Intl.getCanonicalLocales(value.replaceAll("_", "-"))[0] ?? null;
	} catch {
		return null;
	}
}

export function prepareEmailDesign(value: unknown, previous?: EmailDesign): EmailDesign {
	const fail = (): never => {
		throw new Error("EMAIL_DESIGN_INVALID");
	};
	const record = (input: unknown): Record<string, unknown> =>
		input !== null && typeof input === "object" && !Array.isArray(input)
			? (input as Record<string, unknown>)
			: fail();
	const string = (input: unknown, max = 20_000): string =>
		typeof input === "string" && input.length <= max ? input : fail();
	const number = (input: unknown, min: number, max: number): number =>
		typeof input === "number" && Number.isFinite(input) && input >= min && input <= max
			? input
			: fail();
	const color = (input: unknown): string =>
		/^#[0-9a-f]{6}$/i.test(string(input, 7)) ? String(input) : fail();
	const source = record(value);
	if (
		JSON.stringify(source).length > 200_000 ||
		source.schema_version !== 1 ||
		!EMAIL_PURPOSES.includes(source.purpose as EmailPurpose)
	)
		fail();
	const sourceLocale = canonicalEmailLocale(source.source_locale) ?? fail();
	const fallbackLocale = canonicalEmailLocale(source.fallback_locale) ?? fail();
	const theme = record(source.theme);
	const font = string(theme.font, 120);
	if (!/^[\w\s,'-]+$/.test(font)) fail();
	let blockCount = 0;
	const blocks = (input: unknown, depth = 0): EmailBlock[] => {
		if (!Array.isArray(input) || input.length > 80 || depth > 3) fail();
		const ids = new Set<string>();
		return (input as unknown[]).map((item) => {
			if (++blockCount > 1000) fail();
			const block = record(item);
			const id = string(block.id, 120);
			if (
				!id ||
				ids.has(id) ||
				!["heading", "text", "image", "button", "divider", "spacer", "columns"].includes(
					String(block.type),
				)
			)
				fail();
			ids.add(id);
			const result: EmailBlock = { id, type: block.type as EmailBlock["type"] };
			for (const key of ["text", "url", "alt", "shared_id"] as const)
				if (block[key] !== undefined)
					result[key] = string(block[key], key === "text" ? 20_000 : 4096);
			for (const key of ["color", "background"] as const)
				if (block[key] !== undefined) result[key] = color(block[key]);
			if (block.align !== undefined) {
				if (!["left", "center", "right"].includes(String(block.align))) fail();
				result.align = block.align as EmailBlock["align"];
			}
			if (block.padding !== undefined) result.padding = number(block.padding, 0, 80);
			if (block.font_size !== undefined) result.font_size = number(block.font_size, 12, 64);
			if (block.columns !== undefined) {
				if (!Array.isArray(block.columns) || block.columns.length < 1 || block.columns.length > 3)
					fail();
				result.columns = (block.columns as unknown[]).map((column) => blocks(column, depth + 1));
			}
			if (block.condition !== undefined) {
				const condition = record(block.condition);
				if (!["equals", "not_equals", "exists"].includes(String(condition.operator))) fail();
				result.condition = {
					field: string(condition.field, 180),
					operator: condition.operator as EmailCondition["operator"],
					...(condition.value === undefined ? {} : { value: string(condition.value, 500) }),
				};
			}
			return result;
		});
	};
	const locales: Record<string, EmailTranslation> = {};
	const entries = Object.entries(record(source.locales));
	if (!entries.length || entries.length > 60) fail();
	for (const [key, raw] of entries) {
		const locale = canonicalEmailLocale(key) ?? fail();
		if (Object.hasOwn(locales, locale)) fail();
		const translation = record(raw);
		if (!["draft", "approved", "needs_review"].includes(String(translation.status))) fail();
		locales[locale] = {
			subject: string(translation.subject, 500),
			preheader: string(translation.preheader, 500),
			blocks: blocks(translation.blocks),
			status: translation.status as EmailTranslationStatus,
			source_revision: number(translation.source_revision, 1, Number.MAX_SAFE_INTEGER),
		};
	}
	if (!locales[sourceLocale] || !locales[fallbackLocale]) fail();
	const signature = (translation?: EmailTranslation) =>
		JSON.stringify(
			translation ? [translation.subject, translation.preheader, translation.blocks] : null,
		);
	const changed =
		previous !== undefined &&
		(sourceLocale !== previous.source_locale ||
			signature(locales[sourceLocale]) !== signature(previous.locales[previous.source_locale]));
	const revision = previous ? previous.source_revision + (changed ? 1 : 0) : 1;
	for (const [locale, translation] of Object.entries(locales)) {
		if (locale === sourceLocale) translation.source_revision = revision;
		else if (changed || translation.source_revision !== revision)
			translation.status = "needs_review";
	}
	return {
		schema_version: 1,
		purpose: source.purpose as EmailPurpose,
		source_locale: sourceLocale,
		fallback_locale: fallbackLocale,
		missing_translation: source.missing_translation === "skip" ? "skip" : "fallback",
		source_revision: revision,
		theme: {
			background: color(theme.background),
			surface: color(theme.surface),
			text: color(theme.text),
			accent: color(theme.accent),
			font,
			width: number(theme.width, 320, 800),
		},
		locales,
	};
}

export function emailPublicationIssues(design: EmailDesign): string[] {
	const issues: string[] = [];
	const fallback = design.locales[design.fallback_locale];
	if (
		!fallback ||
		fallback.status !== "approved" ||
		fallback.source_revision !== design.source_revision
	)
		issues.push("EMAIL_FALLBACK_NOT_APPROVED");
	for (const [locale, translation] of Object.entries(design.locales)) {
		if (
			translation.status === "approved" &&
			(!translation.subject.trim() || !translation.blocks.length)
		)
			issues.push(`EMAIL_TRANSLATION_EMPTY:${locale}`);
	}
	return issues;
}

export function createEmailDesign(locale = "en", purpose: EmailPurpose = "campaign"): EmailDesign {
	const language = canonicalEmailLocale(locale) ?? "en";
	const french = language.split("-")[0] === "fr";
	const copy: Record<EmailPurpose, [string, string, string, string]> = french
		? {
				authentication: [
					"Confirmez votre adresse email",
					"Bienvenue à bord.",
					"Confirmez votre adresse pour terminer la configuration de votre compte.",
					"Confirmer mon adresse",
				],
				billing: [
					"Votre reçu",
					"Merci pour votre confiance.",
					"{{plan_name}}\n{{amount|money}}\n{{paid_at|date}}",
					"Consulter mon reçu",
				],
				notification: [
					"Votre résultat est prêt",
					"C’est prêt.",
					"{{result_name}}\nVotre résultat vous attend dans votre espace.",
					"Ouvrir mon résultat",
				],
				lifecycle: [
					"Votre prochaine étape",
					"On continue ensemble ?",
					"Bonjour {{name}},\nRetrouvez votre progression et passez à la prochaine étape.",
					"Reprendre",
				],
				campaign: [
					"Des nouvelles pour vous",
					"Faites place à la suite.",
					"Découvrez les nouveautés que nous avons préparées pour vous.",
					"Découvrir",
				],
				support: ["Votre demande", "Bonjour {{name}},", "{{reply}}", "Voir la conversation"],
				operator: [
					"Alerte · {{project_name}}",
					"{{alert_title}}",
					"{{alert_description}}",
					"Consulter le tableau de bord",
				],
			}
		: {
				authentication: [
					"Confirm your email address",
					"Welcome aboard.",
					"Confirm your email address to finish setting up your account.",
					"Confirm my email",
				],
				billing: [
					"Your receipt",
					"Thank you for being here.",
					"{{plan_name}}\n{{amount|money}}\n{{paid_at|date}}",
					"View my receipt",
				],
				notification: [
					"Your result is ready",
					"Ready when you are.",
					"{{result_name}}\nYour result is waiting in your workspace.",
					"Open my result",
				],
				lifecycle: [
					"Your next step",
					"Let’s keep going.",
					"Hello {{name}},\nPick up where you left off and take the next step.",
					"Continue",
				],
				campaign: [
					"An update for you",
					"Make room for what’s next.",
					"Explore the latest updates we have prepared for you.",
					"Explore",
				],
				support: ["Your request", "Hello {{name}},", "{{reply}}", "View conversation"],
				operator: [
					"Alert · {{project_name}}",
					"{{alert_title}}",
					"{{alert_description}}",
					"Open dashboard",
				],
			};
	const [subject, heading, body, action] = copy[purpose];
	return {
		schema_version: 1,
		purpose,
		source_locale: language,
		fallback_locale: language,
		missing_translation: "fallback",
		source_revision: 1,
		theme: {
			background: "#f4f4f5",
			surface: "#ffffff",
			text: "#18181b",
			accent: "#2563eb",
			font: "Arial, sans-serif",
			width: 600,
		},
		locales: {
			[language]: {
				subject,
				preheader: "",
				status: "draft",
				source_revision: 1,
				blocks: [
					{
						id: "title",
						type: "heading",
						text: heading,
						align: "center",
						font_size: 32,
					},
					{
						id: "intro",
						type: "text",
						text: body,
						align: "center",
					},
					{
						id: "action",
						type: "button",
						text: action,
						url: "{{action_url}}",
						align: "center",
					},
					...(["campaign", "lifecycle"].includes(purpose)
						? [
								{ id: "footer-divider", type: "divider" as const },
								{
									id: "unsubscribe",
									type: "button" as const,
									text: french ? "Se désabonner" : "Unsubscribe",
									url: "{{unsubscribe_url}}",
									align: "center" as const,
									background: "#ffffff",
									color: "#52525b",
									font_size: 12,
								},
							]
						: []),
				],
			},
		},
	};
}

export function preferredEmailLocale(
	purpose: EmailPurpose,
	context: EmailRenderContext,
): string | null {
	const profile = context.profile ?? {};
	const preference = {
		authentication: [context.request_locale, profile.locale],
		billing: [profile.billing_locale, profile.locale, context.request_locale],
		notification: [profile.notification_locale, profile.locale, context.request_locale],
		lifecycle: [profile.communication_locale, profile.marketing_locale, profile.locale],
		campaign: [profile.marketing_locale, profile.communication_locale, profile.locale],
		support: [context.event?.conversation_locale, profile.support_locale, profile.locale],
		operator: [profile.operator_locale, profile.locale],
	}[purpose];
	return preference.map(canonicalEmailLocale).find((value) => value !== null) ?? null;
}

export function resolveEmailMessage(
	design: EmailDesign,
	context: EmailRenderContext = {},
): ResolvedEmail {
	const requested = preferredEmailLocale(design.purpose, context);
	const candidates = requested ? [...new Set([requested, requested.split("-")[0]!])] : [];
	const marketing = design.purpose === "campaign" || design.purpose === "lifecycle";
	if (!marketing || design.missing_translation === "fallback")
		candidates.push(design.fallback_locale);
	for (const locale of new Set(candidates)) {
		const content = design.locales[locale];
		if (
			!content ||
			content.status !== "approved" ||
			content.source_revision !== design.source_revision
		)
			continue;
		return {
			status: "ready",
			purpose: design.purpose,
			locale,
			requested_locale: requested,
			reason:
				locale === requested
					? "exact"
					: requested?.split("-")[0] === locale
						? "base_language"
						: "fallback",
			...renderEmailTranslation(design, locale, context),
		};
	}
	return {
		status: "skipped",
		purpose: design.purpose,
		reason: "translation_unavailable",
		requested_locale: requested,
	};
}

export function emailValue(context: EmailRenderContext, field: string): unknown {
	const values = {
		...context.profile,
		profile: context.profile,
		event: context.event,
		...context.event,
		...(context.unsubscribe_url ? { unsubscribe_url: context.unsubscribe_url } : {}),
	};
	return field.split(".").reduce<unknown>((value, key) => {
		if (["__proto__", "constructor", "prototype"].includes(key)) return undefined;
		return value && typeof value === "object" && Object.hasOwn(value, key)
			? (value as Record<string, unknown>)[key]
			: undefined;
	}, values);
}

export function emailBlockVisible(block: EmailBlock, context: EmailRenderContext): boolean {
	if (!block.condition) return true;
	const value = emailValue(context, block.condition.field);
	if (block.condition.operator === "exists")
		return value !== undefined && value !== null && value !== "";
	return block.condition.operator === "equals"
		? String(value ?? "") === block.condition.value
		: String(value ?? "") !== block.condition.value;
}

export function escapeEmailHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export function safeEmailUrl(value: string): string {
	try {
		const url = new URL(value);
		return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : "";
	} catch {
		return "";
	}
}

export function renderEmailTranslation(
	design: EmailDesign,
	locale: string,
	context: EmailRenderContext = {},
) {
	const content = design.locales[locale];
	if (!content) throw new Error("EMAIL_TRANSLATION_MISSING");
	const missing = new Set<string>();
	const interpolate = (input = "") =>
		input.replace(
			/\{\{\s*([\w.]+)(?:\s*\|\s*(date|money))?\s*\}\}/g,
			(token: string, field: string, format?: string) => {
				const value = emailValue(context, field);
				if (value === undefined || value === null) {
					missing.add(field);
					return token;
				}
				if (format === "money") {
					if (!context.currency || !Number.isFinite(Number(value))) {
						missing.add(context.currency ? field : "currency");
						return token;
					}
					try {
						return new Intl.NumberFormat(locale, {
							style: "currency",
							currency: context.currency,
						}).format(Number(value));
					} catch {
						missing.add("currency");
						return token;
					}
				}
				if (format === "date") {
					try {
						return new Intl.DateTimeFormat(locale, {
							dateStyle: "medium",
							timeZone: context.time_zone ?? "UTC",
						}).format(new Date(String(value)));
					} catch {
						missing.add(field);
						return token;
					}
				}
				return typeof value === "object" ? "" : String(value);
			},
		);
	const direction = /^(ar|fa|he|ur)(-|$)/.test(locale) ? "rtl" : "ltr";
	const color = (value: string | undefined, fallback: string) =>
		/^#[0-9a-f]{6}$/i.test(value ?? "") ? value! : fallback;
	const theme = design.theme;
	const textParts: string[] = [];
	const render = (blocks: EmailBlock[], depth = 0): string => {
		if (depth > 4) return "";
		return blocks
			.filter((block) => emailBlockVisible(block, context))
			.map((block) => {
				const raw = interpolate(block.text);
				const text = escapeEmailHtml(raw).replaceAll("\n", "<br>");
				const href = safeEmailUrl(interpolate(block.url));
				const align = ["left", "right", "center"].includes(block.align ?? "")
					? block.align!
					: direction === "rtl"
						? "right"
						: "left";
				const padding = Math.max(0, Math.min(80, block.padding ?? 16));
				const style = `padding:${padding}px 24px;text-align:${align};color:${color(block.color, theme.text)};${block.background ? `background:${color(block.background, theme.surface)};` : ""}`;
				let html = "";
				if (block.type === "heading")
					html = `<h1 style="margin:0;font-size:${Math.max(14, Math.min(64, block.font_size ?? 28))}px;line-height:1.25">${text}</h1>`;
				if (block.type === "text")
					html = `<p style="margin:0;font-size:${Math.max(12, Math.min(36, block.font_size ?? 16))}px;line-height:1.6">${text}</p>`;
				if (block.type === "button")
					html = `<a href="${escapeEmailHtml(href)}" style="display:inline-block;background:${color(block.background, theme.accent)};color:${color(block.color, "#ffffff")};padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:bold">${text}</a>`;
				if (block.type === "image")
					html = href
						? `<img src="${escapeEmailHtml(href)}" alt="${escapeEmailHtml(interpolate(block.alt))}" width="${theme.width - 48}" style="display:block;width:100%;max-width:100%;height:auto;border:0">`
						: "";
				if (block.type === "divider") html = '<hr style="border:0;border-top:1px solid #e4e4e7">';
				if (block.type === "spacer") html = `<div style="height:${padding}px">&#8203;</div>`;
				if (block.type === "columns")
					html = `<table role="presentation" width="100%"><tr>${(block.columns ?? []).map((column) => `<td class="column" valign="top"><table role="presentation" width="100%">${render(column, depth + 1)}</table></td>`).join("")}</tr></table>`;
				if (raw) textParts.push(raw + (block.type === "button" && href ? `: ${href}` : ""));
				return `<tr><td data-email-block="${escapeEmailHtml(block.id)}" style="${style}">${html}</td></tr>`;
			})
			.join("");
	};
	const body = render(content.blocks);
	const subject = interpolate(content.subject).replace(/[\r\n]/g, " ");
	const preheader = escapeEmailHtml(interpolate(content.preheader));
	return {
		subject,
		html: `<!doctype html><html lang="${escapeEmailHtml(locale)}" dir="${direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media(max-width:620px){.column{display:block!important;width:100%!important}}</style></head><body style="margin:0;background:${theme.background};font-family:${escapeEmailHtml(theme.font)};color:${theme.text}"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preheader}</div><table role="presentation" width="100%" style="background:${theme.background}"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="${theme.width}" style="width:100%;max-width:${theme.width}px;background:${theme.surface};border-radius:12px" cellspacing="0" cellpadding="0">${body}</table></td></tr></table></body></html>`,
		text: textParts.join("\n\n"),
		missing_variables: [...missing],
	};
}
