import { env } from "cloudflare:test";
import { Hono } from "hono";
import { expect, test } from "vitest";

import {
	melodyBindings,
	integratedIdentityEnv,
} from "../../../../../../packages/plugins/superboard-authentification/worker/src/melody-runtime.js";
import type { Context as MelodyContext } from "../../../../../../packages/plugins/superboard-authentification/worker/src/melody/configs/type.js";
import { sendPasswordReset } from "../../../../../../packages/plugins/superboard-authentification/worker/src/melody/services/email.js";

test("a password reset email carries the rendered template with the default branding", async () => {
	const delivered: Array<{ html: string }> = [];
	const bindings = {
		...melodyBindings(integratedIdentityEnv(env), { projectId: 101 }),
		EMAIL_PROVIDER_NAME: "superboard",
		LOG_LEVEL: "silent",
		EMAIL_SERVICE: {
			fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
				delivered.push(await new Request(input, init).json<{ html: string }>());
				return Response.json({ id: "captured", status: "queued" });
			},
		},
	};
	const app = new Hono<MelodyContext>();
	let code: string | null = null;
	app.post("/send", async (c) => {
		code = await sendPasswordReset(c, "reset@example.test", "en");
		return c.json({ accepted: !!code });
	});

	const response = await app.fetch(
		new Request("https://identity.test/send", { method: "POST" }),
		bindings,
	);

	expect(await response.json()).toEqual({ accepted: true });
	expect(delivered).toHaveLength(1);
	const html = delivered[0]?.html ?? "";
	expect(html).toContain("<html");
	expect(html).toContain(String(code));
	expect(html).toContain(bindings.COMPANY_EMAIL_LOGO_URL);
});
