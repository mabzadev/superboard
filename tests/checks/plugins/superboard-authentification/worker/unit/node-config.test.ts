import { expect, it } from "vitest";

import { parseNodeVariables } from "../../../../../../packages/plugins/superboard-authentification/worker/src/melody/node-config.js";

it("preserves the native values consumed by the retained Node configuration", () => {
	expect(
		parseNodeVariables(
			'[vars]\nNAME="example"\nENABLE_SIGN_UP=false\nPORT=0\nSUPPORTED_LOCALES=["en","fr"]',
		),
	).toEqual({
		NAME: "example",
		ENABLE_SIGN_UP: false,
		PORT: 0,
		SUPPORTED_LOCALES: ["en", "fr"],
	});
});

it("requires a TOML table for the retained Node variables", () => {
	for (const source of ['name="missing vars"', 'vars="invalid"', 'vars=["invalid"]'])
		expect(() => parseNodeVariables(source)).toThrow("Invalid Wrangler variable");
});
