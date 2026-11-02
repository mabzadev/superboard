import { defineMiddleware } from "astro:middleware";

import { getAuthMode } from "../../auth/mode.js";

export const onRequest = defineMiddleware(async (context, next) => {
	const isAdminRoute = context.url.pathname.startsWith("/_emdash/admin");
	const isSetupRoute = context.url.pathname.startsWith("/_emdash/admin/setup");

	if (isAdminRoute && !isSetupRoute) {
		const { emdash } = context.locals;

		if (!emdash?.db) {
			return next();
		}

		try {
			const setupComplete = await emdash.db
				.selectFrom("options")
				.select("value")
				.where("name", "=", "emdash:setup_complete")
				.executeTakeFirst();

			const isComplete =
				setupComplete &&
				(() => {
					try {
						const parsed = JSON.parse(setupComplete.value);
						return parsed === true || parsed === "true";
					} catch {
						return false;
					}
				})();

			if (!isComplete) {
				return context.redirect("/_emdash/admin/setup");
			}

			const authMode = getAuthMode(emdash.config);

			if (authMode.type === "passkey") {
				const userCount = await emdash.db
					.selectFrom("users")
					.select((eb) => eb.fn.countAll<number>().as("count"))
					.executeTakeFirstOrThrow();

				if (userCount.count === 0) {
					return context.redirect("/_emdash/admin/setup");
				}
			}
		} catch (error) {
			if (error instanceof Error && error.message.includes("no such table")) {
				return context.redirect("/_emdash/admin/setup");
			}

			console.error("Setup middleware error:", error);
		}
	}

	return next();
});
