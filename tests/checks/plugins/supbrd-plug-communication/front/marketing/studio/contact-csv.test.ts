import { expect, it } from "vitest";

import { parseContactCsv } from "../../../../../../../packages/plugins/supbrd-plug-communication/src/front/marketing/studio/contact-csv.js";

it("imports quoted commas, embedded newlines, locale and JSON attributes", () => {
	expect(
		parseContactCsv(
			'email,name,locale,attributes_json\r\nalex@example.test,"Alex,\nMartin",fr-CH,"{""plan"":""pro""}"',
		),
	).toEqual([
		{
			email: "alex@example.test",
			name: "Alex,\nMartin",
			attributes: { plan: "pro", locale: "fr-CH" },
		},
	]);
	expect(() => parseContactCsv('email,name\ninvalid,"unfinished')).toThrow();
});
