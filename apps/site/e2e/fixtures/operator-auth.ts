import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { createRealAuthState } from "./real-auth.js";
import { operatorHeaders, siteUrl, unique, unwrap } from "./site-api.js";

const CAPTURED_LINK = /https?:\/\/[^\s]+/u;

export async function ownerRequest(page: Page) {
	const context = await page.context().browser()!.newContext({ baseURL: siteUrl() });
	const owner = await context.newPage();
	await createRealAuthState(owner);
	return { request: owner.request, close: () => context.close() };
}
export async function useCapture(request: APIRequestContext) {
	const settings = unwrap(await (await request.get("/_emdash/api/settings/email")).json());
	if (!settings.providers.some((p: { pluginId: string }) => p.pluginId === "emdash-console-email"))
		throw new Error("Local email capture provider is required for authentication tests");
	const selected = await request.put("/_emdash/api/admin/hooks/exclusive/email:deliver", {
		headers: operatorHeaders(),
		data: { pluginId: "emdash-console-email" },
	});
	expect(selected.ok()).toBe(true);
	const domains = unwrap(
		await (await request.get("/_emdash/api/admin/allowed-domains")).json(),
	).domains;
	if (!domains.some((d: { domain: string }) => d.domain === "example.test")) {
		const allowed = await request.post("/_emdash/api/admin/allowed-domains", {
			headers: operatorHeaders(),
			data: { domain: "example.test", defaultRole: 30 },
		});
		expect(allowed.ok()).toBe(true);
	}
}
export async function virtualPasskey(page: Page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("WebAuthn.enable");
	const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
		options: {
			protocol: "ctap2",
			transport: "internal",
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});
	return { cdp, authenticatorId };
}
export async function capturedLink(request: APIRequestContext, email: string) {
	let value: { message: { to: string; text: string } } | undefined;
	await expect
		.poll(async () => {
			const records = unwrap(await (await request.get("/_emdash/api/dev/emails")).json()).items;
			value = records.find((record: { message: { to: string } }) => record.message.to === email);
			return Boolean(value);
		})
		.toBe(true);
	const raw = value!.message.text.match(CAPTURED_LINK)?.[0];
	if (!raw) throw new Error("Captured email lacks its action link");
	const parsed = new URL(raw);
	return `${parsed.pathname}${parsed.search}`;
}
export async function invitedOperator(page: Page) {
	const owner = await ownerRequest(page);
	const email = `${unique("operator")}@example.test`;
	try {
		await useCapture(owner.request);
		const invitation = await owner.request.post("/_emdash/api/auth/invite", {
			headers: operatorHeaders(),
			data: { email, role: 50 },
		});
		expect(invitation.ok()).toBe(true);
		const raw = unwrap(await invitation.json());
		const action = raw.inviteUrl
			? new URL(raw.inviteUrl)
			: new URL(await capturedLink(owner.request, email), siteUrl());
		const token = action.searchParams.get("token");
		if (!token) throw new Error("Real invitation token missing");
		const device = await virtualPasskey(page);
		await page.goto(`/accept-invite?token=${encodeURIComponent(token)}`);
		await page.getByRole("textbox", { name: "Name", exact: true }).fill("Site E2E operator");
		await page.getByRole("button", { name: "Complete registration", exact: true }).click();
		await expect.poll(() => new URL(page.url()).pathname).toBe("/superboard-system/home");
		const account = unwrap(await (await page.request.get("/_emdash/api/auth/me")).json());
		const user = account.user ?? account;
		expect(user.email).toBe(email);
		return { id: String(user.id), email, ...device };
	} finally {
		await owner.close();
	}
}
export async function logout(page: Page) {
	expect(
		(await page.request.post("/_emdash/api/auth/logout", { headers: operatorHeaders() })).ok(),
	).toBe(true);
}
