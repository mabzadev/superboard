import { env } from "cloudflare:test";
import { Hono } from "hono";
import { expect, test, vi } from "vitest";

import {
	melodyBindings,
	integratedIdentityEnv,
} from "../../../../../../packages/plugins/supbrd-plug-identity/worker/src/melody-runtime.js";
import type { Context as MelodyContext } from "../../../../../../packages/plugins/supbrd-plug-identity/worker/src/melody/configs/type.js";
import { getAll } from "../../../../../../packages/plugins/supbrd-plug-identity/worker/src/melody/models/smsLog.js";
import { sendSmsMfa } from "../../../../../../packages/plugins/supbrd-plug-identity/worker/src/melody/services/sms.js";
import type { IdentityEnv } from "../../../../../../packages/plugins/supbrd-plug-identity/worker/src/types.js";

test("local SMS capture persists the actual MFA message and a redacted scoped log without Twilio", async () => {
	const bindings = {
		...melodyBindings(integratedIdentityEnv(env as unknown as IdentityEnv), { projectId: 101 }),
		ENVIRONMENT: "dev",
		SMS_TRANSPORT: "capture",
		SUPPORTED_LOCALES: ["en"],
		ENABLE_SMS_LOG: true,
		LOG_LEVEL: "silent",
	};
	const app = new Hono<MelodyContext>();
	let code: string | null = null;
	app.post("/send", async (c) => {
		code = await sendSmsMfa(c, "+15555550123", "en");
		return c.json({ accepted: !!code });
	});
	const uuid = vi
		.spyOn(crypto, "randomUUID")
		.mockReturnValue("aa123456-1111-4111-8111-abcdefabcdef");
	const network = vi
		.spyOn(globalThis, "fetch")
		.mockRejectedValue(new Error("External delivery forbidden in capture test"));
	try {
		const response = await app.fetch(
			new Request("https://sms.test/send", { method: "POST" }),
			bindings as MelodyContext["Bindings"],
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ accepted: true });
		expect(typeof code === "string" && /^\d{6}$/.test(code)).toBe(true);
		const rows = await getAll(bindings.DB, { projectId: 101 });
		const row = rows.find((item) => item.receiver === "+15555550123");
		expect(row?.success).toBe(true);
		expect(row?.content.includes(code!)).toBe(false);
		const receipt = JSON.parse(row!.response) as { transport: string; captureId: string };
		expect(receipt.transport).toBe("capture");
		const captured = (await bindings.KV.get(`sms-capture:${receipt.captureId}`, "json")) as {
			body: string;
			receiver: string;
			projectId: number;
		} | null;
		expect(captured?.receiver).toBe("+15555550123");
		expect(captured?.projectId).toBe(101);
		expect(captured?.body.includes(code!)).toBe(true);
		expect(network).not.toHaveBeenCalled();
	} finally {
		network.mockRestore();
		uuid.mockRestore();
	}
});

test("SMS capture is refused in the production runtime even with Twilio credentials", async () => {
	const bindings = {
		...melodyBindings(integratedIdentityEnv(env as unknown as IdentityEnv), { projectId: 101 }),
		ENVIRONMENT: "prod",
		SMS_TRANSPORT: "capture",
		TWILIO_ACCOUNT_ID: "test-account",
		TWILIO_AUTH_TOKEN: "test-secret",
		TWILIO_SENDER_NUMBER: "+15555550100",
		SUPPORTED_LOCALES: ["en"],
		ENABLE_SMS_LOG: true,
		LOG_LEVEL: "silent",
	};
	const app = new Hono<MelodyContext>();
	app.post("/send", async (c) => {
		await sendSmsMfa(c, "+15555550124", "en");
		return c.json({ accepted: true });
	});
	const network = vi
		.spyOn(globalThis, "fetch")
		.mockRejectedValue(new Error("External delivery forbidden in capture test"));
	try {
		const response = await app.fetch(
			new Request("https://sms.test/send", { method: "POST" }),
			bindings as MelodyContext["Bindings"],
		);
		expect(response.status).not.toBe(200);
		expect(network).not.toHaveBeenCalled();
		expect(
			(await getAll(bindings.DB, { projectId: 101 })).some(
				(row) => row.receiver === "+15555550124",
			),
		).toBe(false);
	} finally {
		network.mockRestore();
	}
});
