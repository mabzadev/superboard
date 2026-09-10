import { createEmailDesign } from "@superboard/contracts/email-studio";
import { describe, expect, it } from "vitest";

import {
	applyEmailTranslation,
	emailTranslationFields,
	translateEmail,
} from "../../../../../../packages/plugins/supbrd-plug-communication/marketing/src/email-translation.js";

describe("email translation", () => {
	it("changes only copy and retains protected variables and actions", () => {
		const source = createEmailDesign("en").locales.en!;
		source.blocks = [
			{ id: "cta", type: "button", text: "Welcome {{name}}", url: "https://example.test/action" },
		];
		const fields = emailTranslationFields(source).map((field) => ({
			...field,
			value: field.key === "blocks.0.text" ? "Bienvenue {{name}}" : field.value,
		}));
		const translated = applyEmailTranslation(source, fields);
		expect(translated.blocks[0]).toEqual({
			id: "cta",
			type: "button",
			text: "Bienvenue {{name}}",
			url: "https://example.test/action",
		});
		expect(translated.status).toBe("needs_review");
		expect(source.blocks[0]!.text).toBe("Welcome {{name}}");
		expect(() =>
			applyEmailTranslation(
				source,
				fields.map((field) => ({ ...field, value: field.value.replace("{{name}}", "Alex") })),
			),
		).toThrow("protected variable");
	});
	it("does not call the provider for a private endpoint", async () => {
		let called = false;
		await expect(
			translateEmail(
				{ url: "https://127.0.0.1/v1/responses", model: "configured-model", api_key: "test" },
				createEmailDesign(),
				"fr",
				[],
				async () => {
					called = true;
					return Response.json({});
				},
			),
		).rejects.toThrow("public HTTPS");
		expect(called).toBe(false);
	});
});
