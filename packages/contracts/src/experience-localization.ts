import { canonicalEmailLocale } from "./email-studio.js";

export type ExperienceTranslations = {
	source_locale: string;
	fallback_locale: string;
	locales: Record<string, Record<string, Record<string, unknown>>>;
};

export function experienceTranslations(metadata: Record<string, unknown>): ExperienceTranslations {
	const value = metadata.localization;
	if (!value || typeof value !== "object" || Array.isArray(value))
		return { source_locale: "en", fallback_locale: "en", locales: {} };
	const input = value as Record<string, unknown>;
	const locales: ExperienceTranslations["locales"] = {};
	if (input.locales && typeof input.locales === "object" && !Array.isArray(input.locales)) {
		for (const [key, translation] of Object.entries(input.locales)) {
			const locale = canonicalEmailLocale(key);
			if (locale && translation && typeof translation === "object" && !Array.isArray(translation))
				locales[locale] = translation as Record<string, Record<string, unknown>>;
		}
	}
	return {
		source_locale: canonicalEmailLocale(input.source_locale) ?? "en",
		fallback_locale: canonicalEmailLocale(input.fallback_locale) ?? "en",
		locales,
	};
}

export function localizeExperienceDefinition(
	value: Record<string, unknown>,
	requested?: string | null,
): Record<string, unknown> {
	const definition = structuredClone(value);
	const translations = experienceTranslations(
		(definition.metadata ?? {}) as Record<string, unknown>,
	);
	const locale = canonicalEmailLocale(requested);
	if (locale === translations.source_locale || locale?.split("-")[0] === translations.source_locale)
		return definition;
	const selected = [locale, locale?.split("-")[0], translations.fallback_locale].find(
		(key) => key && translations.locales[key],
	);
	if (!selected || selected === translations.source_locale) return definition;
	const changes = translations.locales[selected]!;
	const apply = (raw: unknown, screenId?: string) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
		const block = raw as Record<string, unknown>;
		const translated =
			(screenId ? changes[screenId + "/" + String(block.id)] : undefined) ??
			changes[String(block.id)];
		if (!translated || typeof translated !== "object") return block;
		const props = { ...(block.props as Record<string, unknown>) };
		for (const key of [
			"text",
			"alt",
			"accessibility_label",
			"items",
			"url",
			"title",
			"body",
			"required_message",
		] as const) {
			const translatedValue = translated[key];
			if (
				typeof translatedValue === "string" ||
				(key === "items" &&
					Array.isArray(translatedValue) &&
					translatedValue.every((item) => typeof item === "string"))
			)
				props[key] = translatedValue;
		}
		if (Array.isArray(props.options) && Array.isArray(translated.options)) {
			const labels = translated.options.filter(
				(option): option is { value: string; label: string } =>
					option !== null &&
					typeof option === "object" &&
					typeof option.value === "string" &&
					typeof option.label === "string",
			);
			props.options = props.options.map((option) => {
				if (!option || typeof option !== "object") return option;
				const translated = labels.find(
					(value) => value.value === (option as Record<string, unknown>).value,
				);
				return translated ? { ...option, label: translated.label } : option;
			});
		}
		return { ...block, props };
	};
	if (Array.isArray(definition.components))
		definition.components = definition.components.map((block) => apply(block));
	if (Array.isArray(definition.screens))
		definition.screens = definition.screens.map((raw) => {
			if (!raw || typeof raw !== "object") return raw;
			const screen = raw as Record<string, unknown>;
			return {
				...screen,
				blocks: Array.isArray(screen.blocks)
					? screen.blocks.map((block) => apply(block, String(screen.id)))
					: screen.blocks,
			};
		});
	return definition;
}

export function validateExperienceEditor(value: {
	screens: Array<{
		id: string;
		name: string;
		next_screen_id?: string | null;
		blocks: Array<{ id: string; type: string; props: Record<string, unknown> }>;
	}>;
	theme: { accent_color: string };
}): string[] {
	const issues: string[] = [];
	if (!value.screens.length || value.screens.length > 100)
		issues.push("Use between 1 and 100 screens.");
	const screens = new Set(value.screens.map((screen) => screen.id));
	if (screens.size !== value.screens.length) issues.push("Screen identifiers must be unique.");
	for (const screen of value.screens) {
		if (!screen.name.trim()) issues.push("Every screen needs a name.");
		if (!screen.blocks.length) issues.push("Every screen needs at least one block.");
		if (screen.next_screen_id && !screens.has(screen.next_screen_id))
			issues.push("A screen points to a missing destination.");
		const blocks = new Set<string>();
		for (const block of screen.blocks) {
			if (!block.id || blocks.has(block.id))
				issues.push("Block identifiers must be unique within each screen.");
			blocks.add(block.id);
			if (
				["heading", "text", "button", "legal"].includes(block.type) &&
				!String(block.props.text ?? "").trim()
			)
				issues.push("Text cannot be empty.");
			if (block.type === "product" && !String(block.props.offering_identifier ?? "").trim())
				issues.push("Choose an offering for each product block.");
			if (block.type === "question") {
				if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(String(block.props.attribute ?? "")))
					issues.push("Choose a valid attribute for each question.");
				const options = Array.isArray(block.props.options)
					? (block.props.options as Array<Record<string, unknown>>)
					: [];
				if (!options.length || options.length > 30)
					issues.push("A question needs between 1 and 30 choices.");
				if (new Set(options.map((option) => option.value)).size !== options.length)
					issues.push("Answer values must be unique.");
				for (const option of options) {
					if (
						typeof option.value !== "string" ||
						!option.value ||
						typeof option.label !== "string" ||
						!option.label.trim()
					)
						issues.push("Every choice needs a value and a label.");
					if (option.next_screen_id && !screens.has(String(option.next_screen_id)))
						issues.push("A choice points to a missing screen.");
				}
			}
			if (
				block.type === "marketing_consent" &&
				(block.props.default === true || block.props.required === true)
			)
				issues.push("Email consent must be optional and unchecked.");
		}
	}
	if (!/^#[0-9a-f]{6}$/i.test(value.theme.accent_color))
		issues.push("Choose a valid accent color.");
	return [...new Set(issues)];
}
