import { expect, test as base, type Page } from "@playwright/test";

import { createRealAuthState } from "./real-auth.js";

const intlError = /MISSING_MESSAGE|INVALID_MESSAGE|IntlError/;

type Fixtures = { authenticatedPage: Page };
export const test = base.extend<Fixtures>({
	authenticatedPage: async ({ page }, use) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error" && intlError.test(message.text())) errors.push(message.text());
		});
		await createRealAuthState(page);
		await use(page);
		expect(errors, "Browser execution and translation errors").toEqual([]);
	},
});
export { expect } from "@playwright/test";
