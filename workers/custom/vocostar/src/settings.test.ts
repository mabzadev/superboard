import { expect, test } from "vitest";

import { configureVocostarJob } from "./settings.js";

const job = {
	idempotencyKey: "conversion:123",
	projectRef: "11-test",
	capability: "vocostar.media.convert",
	requestedAt: "2026-09-07T00:00:00.000Z",
	payload: { creditCost: 1, input: { text: "Bonjour", language: "fr" } },
};

test("configured credit cost overrides the caller while preserving the original request", () => {
	expect(configureVocostarJob(job, { media_credit_cost: 25 }).payload.creditCost).toBe(25);
	expect(job.payload.creditCost).toBe(1);
});
test("disabled capabilities, excluded languages and text limits reject processing", () => {
	expect(() => configureVocostarJob(job, { media_conversion_enabled: false })).toThrow(
		"capability_disabled",
	);
	expect(() => configureVocostarJob(job, { allowed_locales: "en de" })).toThrow(
		"language_disabled",
	);
	expect(() => configureVocostarJob(job, { text_max_characters: 3 })).toThrow("text_too_long");
});
