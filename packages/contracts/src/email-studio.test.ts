import { describe, expect, it } from "vitest";

import {
	createEmailDesign,
	prepareEmailDesign,
	renderEmailTranslation,
	resolveEmailMessage,
} from "./email-studio.js";

describe("multilingual email delivery", () => {
	it("uses the billing preference and regional fallback without inferring language from country", () => {
		const design = createEmailDesign("en", "billing");
		design.locales.en!.status = "approved";
		design.locales.fr = {
			...structuredClone(design.locales.en!),
			subject: "Votre reçu",
			blocks: [{ id: "receipt", type: "text", text: "Merci {{name}}" }],
		};
		const result = resolveEmailMessage(design, {
			profile: { locale: "en", billing_locale: "fr-CH", country: "DE", name: "Alex" },
		});
		expect(result).toMatchObject({
			status: "ready",
			locale: "fr",
			requested_locale: "fr-CH",
			reason: "base_language",
			subject: "Votre reçu",
		});
		if (result.status === "ready") expect(result.html).toContain("Merci Alex");
	});
	it("invalidates translated content after a source edit while retaining the previous version", () => {
		const previous = createEmailDesign("fr");
		previous.locales.fr!.status = "approved";
		previous.locales.en = {
			...structuredClone(previous.locales.fr!),
			subject: "Welcome",
			status: "approved",
		};
		const edited = structuredClone(previous);
		edited.locales.fr!.subject = "Nouvelle offre";
		const saved = prepareEmailDesign(edited, previous);
		expect(saved.locales.en!.status).toBe("needs_review");
		expect(saved.source_revision).toBe(2);
		expect(previous.locales.en!.status).toBe("approved");
	});
	it("skips an untranslated campaign but uses the approved fallback for an access email", () => {
		const design = createEmailDesign("en");
		design.locales.en!.status = "approved";
		design.missing_translation = "skip";
		expect(resolveEmailMessage(design, { profile: { locale: "de" } }).status).toBe("skipped");
		design.purpose = "authentication";
		expect(
			resolveEmailMessage(design, { request_locale: "de", profile: { locale: "fr" } }),
		).toMatchObject({ status: "ready", locale: "en", requested_locale: "de", reason: "fallback" });
	});
	it("escapes recipient data and rejects dangerous links in the actual email HTML", () => {
		const design = createEmailDesign("en");
		design.locales.en!.blocks = [
			{ id: "name", type: "text", text: "Hello {{name}}" },
			{ id: "link", type: "button", text: "Open", url: "{{action_url}}" },
		];
		const rendered = renderEmailTranslation(design, "en", {
			profile: { name: '<img src=x onerror="alert(1)">', action_url: "javascript:alert(1)" },
		});
		expect(rendered.html).toContain("&lt;img");
		expect(rendered.html).not.toContain("javascript:");
		expect(rendered.html).not.toContain("<img src=x");
	});
});
