import { describe, expect, it } from "vitest";

import { journeyNodeSummary } from "../../../../../../../../packages/plugins/superboard-communication/src/front/marketing/components/modules/JourneyCanvasEditor.js";
import { growthTranslator } from "../../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/growth-i18n.js";
import { studioI18n } from "../../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/i18n.js";

describe("journey step summary", () => {
	it.each([
		["en", "Wait 5 minutes", "up to 2 h"],
		["fr", "Attendre 5 minutes", "jusqu’à 2 h"],
	] as const)("shows the configured durations in %s", (locale, wait, timeout) => {
		const t = growthTranslator(locale, studioI18n(locale));
		expect(
			journeyNodeSummary({ type: "delay", delay_seconds: 300 } as never, [], [], t, String),
		).toBe(wait);
		expect(
			journeyNodeSummary(
				{ type: "wait_event", event_name: "purchase", timeout_seconds: 7_200 } as never,
				[],
				[],
				t,
				String,
			),
		).toContain(timeout);
	});
});
