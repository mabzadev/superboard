import { describe, expect, it } from "vitest";

import {
	createExperienceDocument as createOnboarding,
	validateExperienceDocument,
} from "../../../../../packages/plugins/superboard-acquisition/src/front/onboardings/components/experience-editor/model.js";
import { createExperienceDocument as createPaywall } from "../../../../../packages/plugins/superboard-acquisition/src/front/paywalls/components/experience-editor/model.js";
import { createStudioDocument } from "../../../../../packages/supbrd-front-ui/src/experience-studio.js";

describe("portable experience themes", () => {
	it.each([
		["onboarding", createOnboarding],
		["paywall", createPaywall],
		["studio", () => createStudioDocument("onboarding", "en")],
	] as const)("creates a valid %s document outside the dashboard CSS scope", (_name, create) => {
		const document = create();
		expect(validateExperienceDocument(document)).toEqual([]);
		expect(JSON.stringify(document.theme)).not.toContain("var(");
	});
});
