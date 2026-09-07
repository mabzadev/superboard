import type { APIRequestContext, Page } from "@playwright/test";

export const isRealBackendE2E = true;
export async function createRealAuthState(page: Page, _request?: APIRequestContext) {
	const response = await page.request.get(
		"/_emdash/api/auth/dev-bypass?redirect=/superboard-system/home",
	);
	if (!response.ok()) throw new Error(`Operator session setup failed (${response.status()})`);
	const profile = await page.request.get("/_emdash/api/auth/me");
	if (!profile.ok()) throw new Error(`Operator session verification failed (${profile.status()})`);
	const value = await profile.json();
	if (!value.data?.user?.id && !value.data?.id) throw new Error("Operator identity missing");
}
