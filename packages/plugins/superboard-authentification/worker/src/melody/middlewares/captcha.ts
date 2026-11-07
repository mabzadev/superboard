import type { Context, Next } from "hono";
import { env } from "hono/adapter";

import { captchaConfiguration, captchaRejection, captchaRejectionResponse } from "../../captcha.js";
import type { typeConfig } from "../configs";

async function requestBody(c: Context<typeConfig.Context>): Promise<Record<string, unknown>> {
	try {
		const body: unknown = (c.req.header("content-type") ?? "").includes("application/json")
			? await c.req.json()
			: await c.req.parseBody();
		return body && typeof body === "object" && !Array.isArray(body)
			? Object.fromEntries(Object.entries(body))
			: {};
	} catch {
		return {};
	}
}

export const requireCaptcha = async (c: Context<typeConfig.Context>, next: Next) => {
	const bindings = env(c);
	if (captchaConfiguration(bindings)) {
		const rejection = await captchaRejection(bindings, c.req.raw.headers, await requestBody(c));
		if (rejection) return captchaRejectionResponse(rejection);
	}
	await next();
};
