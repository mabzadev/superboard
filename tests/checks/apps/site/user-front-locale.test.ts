import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { expect, test } from "vitest";

import {
	localizeFrontPath,
	resolveUserFrontRequestLocale,
} from "../../../../apps/site/src/lib/user-front-i18n.js";

test("production Front translations interpolate operator names and section names", async () => {
	const bundle = await build({
		entryPoints: [
			fileURLToPath(new URL("../../../../apps/site/src/lib/user-front-i18n.ts", import.meta.url)),
		],
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		define: { "process.env.NODE_ENV": '"production"' },
	});
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`${bundle.outputFiles[0]!.text}
		const translations = createUserFrontI18n("fr");
		console.log(JSON.stringify({
			account: translations._("site.front.open_account", {name: "Zoë"}),
			section: translations._("site.front.section_navigation", {section: "Commerce"})
		}));
	`,
		],
		{ encoding: "utf8" },
	);
	expect(result.status, result.stderr).toBe(0);
	expect(JSON.parse(result.stdout)).toEqual({
		account: "Ouvrir le menu du compte de Zoë",
		section: "Pages Commerce",
	});
	expect(result.stderr).not.toContain("Uncompiled message");
});

test.each([
	["de-CH,fr;q=0.9,en;q=0.8", "fr"],
	["en;q=0.2,fr-CH;q=0.9", "fr"],
	["fr;q=0,ar;q=0.8", "en"],
	["de", "en"],
])("chooses an accepted supported language from %s", (languages, expected) => {
	expect(
		resolveUserFrontRequestLocale(
			new Request("https://console.test/analytics", { headers: { "Accept-Language": languages } }),
		),
	).toBe(expected);
});

test("the explicit choice wins over a remembered language and Identity URL", () => {
	expect(
		resolveUserFrontRequestLocale(
			new Request("https://console.test/identity/en/dashboard?lang=fr", {
				headers: { Cookie: "superboard-locale=en" },
			}),
		),
	).toBe("fr");
});

test("a remembered French choice wins over an old Identity URL", () => {
	expect(
		resolveUserFrontRequestLocale(
			new Request("https://console.test/identity/en/dashboard", {
				headers: { Cookie: "irrelevant=1; superboard-locale=fr", "Accept-Language": "en" },
			}),
		),
	).toBe("fr");
});

test("Identity links keep the view, parameters and fragment when localized", () => {
	expect(localizeFrontPath("/identity/en/users/member%2F42?tab=roles#details", "fr")).toBe(
		"/identity/fr/users/member%2F42?tab=roles#details",
	);
	expect(localizeFrontPath("/superboard-preview/preview1/identity/en/users", "fr")).toBe(
		"/superboard-preview/preview1/identity/fr/users",
	);
	expect(localizeFrontPath("https://other.test/identity/en/users", "fr")).toBe(
		"https://other.test/identity/en/users",
	);
});

test.each(["ar", "ar-SA", "ar-EG"])(
	"Arabic preference %s cannot reactivate Arabic on the front",
	(language) => {
		expect(
			resolveUserFrontRequestLocale(
				new Request(`https://console.test/analytics?lang=${language}`, {
					headers: {
						Cookie: `superboard-locale=${language}`,
						"Accept-Language": `${language},fr;q=0.9`,
					},
				}),
			),
		).toBe("fr");
		expect(
			resolveUserFrontRequestLocale(
				new Request(`https://console.test/analytics?lang=${language}`, {
					headers: { Cookie: `superboard-locale=${language}`, "Accept-Language": language },
				}),
			),
		).toBe("en");
	},
);
