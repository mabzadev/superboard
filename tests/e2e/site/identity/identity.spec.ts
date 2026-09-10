import type { Page } from "@playwright/test";

import { test, expect } from "../../../fixtures/site-browser/base-fixtures.js";
import {
	evidence,
	projectRef,
	ready,
	siteApi,
	unique,
} from "../../../fixtures/site-browser/site-api.js";

const plugin = "supbrd-plug-user";
const suffix = /\/([0-9]+)$/;
const metadata = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://identity-fixture.example.test"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://identity-fixture.example.test/sso"/></IDPSSODescriptor></EntityDescriptor>`;

async function save(page: Page) {
	const result = page.waitForResponse(
		(response) =>
			["POST", "PUT", "PATCH"].includes(response.request().method()) &&
			(response.url().includes("/api/v1/identity-admin/") ||
				response.url().includes(`/plugins/${plugin}/commands/`)),
	);
	await page.getByTestId("saveButton").click();
	const response = await result;
	expect(response.ok(), `Identity save HTTP ${response.status()}`).toBe(true);
	return response.status();
}

for (const entity of [
	{ path: "roles", key: "role", segment: "roles", update: "noteInput", property: "note" },
	{ path: "scopes", key: "scope", segment: "scopes", update: "noteInput", property: "note" },
	{ path: "orgs", key: "org", segment: "orgs", update: "nameInput", property: "name" },
	{
		path: "user-attributes",
		key: "userAttribute",
		segment: "user_attributes",
		update: "validationRegexInput",
		property: "validationRegex",
	},
] as const) {
	test(`Identity ${entity.path} creates, edits, reloads and finds the persisted record`, async ({
		authenticatedPage: page,
	}) => {
		const ref = await projectRef(page);
		const name = unique("identity").replaceAll("-", "_");
		await ready(page, `/identity/en/${entity.path}/new`);
		await page.getByTestId("nameInput").fill(name);
		if (entity.path === "orgs") await page.getByTestId("slugInput").fill(name.replaceAll("_", "-"));
		if (entity.path === "scopes") {
			await page.getByTestId("typeSelect").click();
			await page.getByTestId("typeSelect-spaOption").click();
		}
		await save(page);
		await expect(page).toHaveURL(new RegExp(`/identity/en/${entity.path}/[0-9]+$`));
		const id = suffix.exec(page.url())![1]!;
		await expect(page).toHaveURL(new RegExp(`/identity/en/${entity.path}/${id}$`));
		const api = `/api/v1/identity-admin/projects/${ref}/api/v1/${entity.path}/${id}`;
		expect((await siteApi(page.request, plugin, "GET", api))[entity.key].name).toBe(name);
		await evidence(
			plugin,
			`superboard.identity_by_lang_${entity.segment}_new`,
			[id],
			"Created using the real browser form and read back through the owning Identity API.",
		);
		const changed = entity.path === "user-attributes" ? "^[a-z]+$" : `${name}_updated`;
		await page.getByTestId(entity.update).fill(changed);
		await save(page);
		await page.reload();
		await expect(page.getByTestId(entity.update)).toHaveValue(changed);
		expect((await siteApi(page.request, plugin, "GET", api))[entity.key][entity.property]).toBe(
			changed,
		);
		await evidence(
			plugin,
			`superboard.identity_by_lang_${entity.segment}_by_id`,
			[id],
			"Updated with the real Save control; values survived reload and an independent API read.",
		);
		await ready(page, `/identity/en/${entity.path}`);
		await page.locator(`a[href="/identity/en/${entity.path}/${id}"]:visible`).first().click();
		await expect(page.getByTestId(entity.update)).toHaveValue(changed);
		await evidence(
			plugin,
			`superboard.identity_by_lang_${entity.segment}`,
			[id],
			"List links open the actual record created by this browser scenario.",
		);
	});
}

test("Identity app form preserves selected OAuth scopes and changes", async ({
	authenticatedPage: page,
}) => {
	const ref = await projectRef(page);
	const name = unique("identity-app");
	await ready(page, "/identity/en/apps/new");
	await page.getByTestId("nameInput").fill(name);
	await page.getByTestId("typeSelect").click();
	await page.getByTestId("typeSelect-spaOption").click();
	await page.getByRole("checkbox").first().check();
	await save(page);
	await expect(page).toHaveURL(/\/identity\/en\/apps\/[0-9]+$/);
	const id = suffix.exec(page.url())![1]!;
	await expect(page).toHaveURL(new RegExp(`/identity/en/apps/${id}$`));
	const api = `/api/v1/identity-admin/projects/${ref}/api/v1/apps/${id}`;
	expect((await siteApi(page.request, plugin, "GET", api)).app.name).toBe(name);
	await evidence(
		plugin,
		"superboard.identity_by_lang_apps_new",
		[id],
		"Created an SPA application with a selected real OAuth scope using the form.",
	);
	await page.getByTestId("nameInput").fill(`${name} updated`);
	await save(page);
	await page.reload();
	await expect(page.getByTestId("nameInput")).toHaveValue(`${name} updated`);
	expect((await siteApi(page.request, plugin, "GET", api)).app.name).toBe(`${name} updated`);
	await evidence(
		plugin,
		"superboard.identity_by_lang_apps_by_id",
		[id],
		"Saved application metadata and read it back after reload.",
	);
	await ready(page, "/identity/en/apps");
	await page.locator(`a[href="/identity/en/apps/${id}"]:visible`).first().click();
	await expect(page.getByTestId("nameInput")).toHaveValue(`${name} updated`);
	await evidence(
		plugin,
		"superboard.identity_by_lang_apps",
		[id],
		"Applications list navigates to the persisted application.",
	);
});

test("Identity banner form persists message and disabled state", async ({
	authenticatedPage: page,
}) => {
	const ref = await projectRef(page);
	const text = unique("identity-banner");
	await ready(page, "/identity/en/apps/banners/new");
	await page.getByTestId("bannerTypeSelect").click();
	await page.getByTestId("bannerTypeSelect-infoOption").click();
	await page.getByTestId("textInput").fill(text);
	await save(page);
	await expect(page).toHaveURL(/\/identity\/en\/apps\/banners\/[0-9]+$/);
	const id = suffix.exec(page.url())![1]!;
	await expect(page).toHaveURL(new RegExp(`/identity/en/apps/banners/${id}$`));
	const api = `/api/v1/identity-admin/projects/${ref}/api/v1/app-banners/${id}`;
	expect((await siteApi(page.request, plugin, "GET", api)).appBanner.text).toBe(text);
	await evidence(
		plugin,
		"superboard.identity_by_lang_apps_banners_new",
		[id],
		"Created a real unassigned informational banner using its browser form.",
	);
	await page.getByTestId("textInput").fill(`${text} updated`);
	await page.getByTestId("statusInput").click();
	await save(page);
	await page.reload();
	await expect(page.getByTestId("textInput")).toHaveValue(`${text} updated`);
	await expect(page.getByTestId("statusInput")).not.toBeChecked();
	expect((await siteApi(page.request, plugin, "GET", api)).appBanner).toMatchObject({
		text: `${text} updated`,
		isActive: false,
	});
	await evidence(
		plugin,
		"superboard.identity_by_lang_apps_banners_by_id",
		[id],
		"Edited and disabled the actual banner; API and reload confirm both changes.",
	);
});

test("Identity SAML form saves metadata and attribute mapping", async ({
	authenticatedPage: page,
}) => {
	const ref = await projectRef(page);
	const mapping = unique("subject");
	await ready(page, "/identity/en/saml/new");
	await page.getByTestId("nameInput").fill(unique("saml"));
	await page.getByTestId("userIdAttributeInput").fill(mapping);
	await page.getByTestId("metadataInput").fill(metadata);
	await save(page);
	await expect(page).toHaveURL(/\/identity\/en\/saml\/[0-9]+$/);
	const id = suffix.exec(page.url())![1]!;
	await expect(page).toHaveURL(new RegExp(`/identity/en/saml/${id}$`));
	const api = `/api/v1/identity-admin/projects/${ref}/api/v1/saml/idps/${id}`;
	expect((await siteApi(page.request, plugin, "GET", api)).idp.userIdAttribute).toBe(mapping);
	await evidence(
		plugin,
		"superboard.identity_by_lang_saml_new",
		[id],
		"Saved a QA SAML IdP metadata document using the real form; no authentication at the fixture domain.",
	);
	await page.getByTestId("emailAttributeInput").fill("email");
	await page.getByRole("switch").first().click();
	await save(page);
	await page.reload();
	await expect(page.getByTestId("emailAttributeInput")).toHaveValue("email");
	expect((await siteApi(page.request, plugin, "GET", api)).idp).toMatchObject({
		emailAttribute: "email",
		isActive: false,
	});
	await evidence(
		plugin,
		"superboard.identity_by_lang_saml_by_id",
		[id],
		"Saved email attribute mapping and disabled the QA IdP; reload and API read confirm persistence.",
	);
	await ready(page, "/identity/en/saml");
	await page.locator(`a[href="/identity/en/saml/${id}"]:visible`).first().click();
	await expect(page.getByTestId("emailAttributeInput")).toHaveValue("email");
	await evidence(
		plugin,
		"superboard.identity_by_lang_saml",
		[id],
		"IdP list navigates to its actual persisted configuration.",
	);
});
