import { expect, it } from "vitest";

import { localizeExperienceDefinition } from "../../../../../packages/contracts/src/experience-localization.js";

it("localizes a paywall for a regional locale while retaining purchase actions and the stored source", () => {
	const source = {
		components: [{ id: "cta", type: "button", props: { text: "Subscribe", action: "purchase" } }],
		metadata: {
			localization: {
				source_locale: "en",
				fallback_locale: "en",
				locales: { fr: { cta: { text: "S’abonner", action: "close" } } },
			},
		},
	};
	expect(localizeExperienceDefinition(source, "fr-CH").components).toEqual([
		{ id: "cta", type: "button", props: { text: "S’abonner", action: "purchase" } },
	]);
	expect(source.components[0]!.props.text).toBe("Subscribe");
});

it("keeps the source language when it matches even if the fallback is translated", () => {
	const source = {
		components: [{ id: "title", type: "heading", props: { text: "Welcome" } }],
		metadata: {
			localization: {
				source_locale: "en",
				fallback_locale: "fr",
				locales: { fr: { title: { text: "Bienvenue" } } },
			},
		},
	};
	expect(localizeExperienceDefinition(source, "en-US").components).toEqual(source.components);
});
