import { test, expect } from "../../fixtures/base-fixtures.js";
import { flowFixture } from "../../fixtures/flows.js";
import { evidence, ready } from "../../fixtures/site-api.js";

test.describe("Flows workflow editor on the owning Worker", () => {
	test.beforeEach(async ({ authenticatedPage: page }) => {
		await page.setViewportSize({ width: 1600, height: 1000 });
	});
	test("edits, validates, saves and publishes a real workflow", async ({
		authenticatedPage: page,
	}) => {
		const f = await flowFixture(page);
		await ready(page, `/flows/workflows/${f.workflow.id}`);
		await expect(page.locator(".react-flow__node")).toHaveCount(5);
		await expect(page.getByText("Graph is valid", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Add block", exact: true }).click();
		await page.getByPlaceholder("Search blocks").fill("note");
		await page.getByRole("button", { name: /^Note/ }).click();
		await expect(page.locator(".react-flow__node")).toHaveCount(6);
		await page.getByRole("button", { name: "Undo", exact: true }).click();
		await expect(page.locator(".react-flow__node")).toHaveCount(5);
		await page.getByRole("button", { name: "Redo", exact: true }).click();
		await expect(page.locator(".react-flow__node")).toHaveCount(6);
		await page.getByRole("button", { name: "Save changes", exact: true }).click();
		await expect
			.poll(
				async () =>
					(await f.request("GET", `/workflows/${f.workflow.id}`)).draft.graph.blocks.length,
			)
			.toBe(6);
		await page.getByRole("button", { name: "Publish", exact: true }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByPlaceholder("What changed?").fill("Published from native Site E2E");
		await dialog.getByRole("combobox").nth(1).click();
		await page.getByRole("option", { name: f.environment.name, exact: true }).click();
		await dialog.getByRole("button", { name: "Publish", exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect
			.poll(async () =>
				(await f.request("GET", `/workflows/${f.workflow.id}`)).releases.some(
					(release: { active: boolean | number }) => Boolean(release.active),
				),
			)
			.toBe(true);
		const saved = await f.request("GET", `/workflows/${f.workflow.id}`);
		expect(saved.versions.length).toBe(1);
		expect(saved.versions[0].changelog).toBe("Published from native Site E2E");
		expect(
			saved.releases.some((release: { active: boolean | number }) => Boolean(release.active)),
		).toBe(true);
		await evidence(
			"supbrd-plugmod-flows",
			"superboard.flows_workflows_by_id",
			[f.workflow.id, saved.versions[0].id],
			"Added a block, exercised undo/redo, saved the graph, published a real version and activated a release.",
		);
	});
	test("opens workflow and survey analytics from its stored graph", async ({
		authenticatedPage: page,
	}) => {
		const f = await flowFixture(page);
		await ready(page, `/flows/workflows/${f.workflow.id}`);
		await page.getByRole("tab", { name: "Analytics", exact: true }).click();
		await expect(page.getByText("Event totals", { exact: true })).toBeVisible();
		await expect(page.getByText("Survey results", { exact: true })).toBeVisible();
		const analytics = await f.request("GET", `/workflows/${f.workflow.id}/analytics`);
		expect(analytics).toBeTruthy();
	});
	test("creates exact SDK blocks from a persisted versioned component catalog", async ({
		authenticatedPage: page,
	}) => {
		const f = await flowFixture(page);
		await ready(page, `/flows/workflows/${f.workflow.id}`);
		await page.getByRole("button", { name: "Add block", exact: true }).click();
		await page.getByPlaceholder("Search blocks").fill(f.modal.name);
		await page.getByRole("button", { name: new RegExp(`^${f.modal.name}`) }).click();
		await expect(page.locator(".react-flow__node")).toHaveCount(6);
		await page.getByRole("button", { name: "Save changes", exact: true }).click();
		await expect
			.poll(async () =>
				(await f.request("GET", `/workflows/${f.workflow.id}`)).draft.graph.blocks.some(
					(block: { data: { componentKey?: string } }) => block.data.componentKey === f.modal.key,
				),
			)
			.toBe(true);
		const saved = await f.request("GET", `/workflows/${f.workflow.id}`);
		expect(
			saved.draft.graph.blocks.find(
				(block: { data: { componentKey?: string } }) => block.data.componentKey === f.modal.key,
			),
		).toMatchObject({
			type: "component",
			componentType: "BasicsV2Modal",
			componentLibraryName: f.library.name,
			data: { componentKey: f.modal.key, componentVersion: 1 },
			exitNodes: ["continue", "close"],
		});
	});
	test("identifies outdated instances and synchronizes both stored drafts explicitly", async ({
		authenticatedPage: page,
	}) => {
		const f = await flowFixture(page);
		const duplicate = await f.request("POST", `/workflows/${f.workflow.id}/duplicate`, {
			name: f.workflow.name + " duplicate",
			identifier: f.workflow.identifier + "-copy",
		});
		await f.request("PATCH", `/components/${f.card.id}`, {
			schema: {
				template_type: "component",
				properties: { title: { type: "string", default: "Updated" } },
			},
		});
		await ready(page, "/flows/components");
		const card = page
			.getByText(f.card.name, { exact: true })
			.locator('xpath=ancestor::*[@data-slot="card"][1]');
		await expect(card.getByText("Outdated instances: 2", { exact: true })).toBeVisible();
		await card.getByRole("button", { name: "Update instances (2)", exact: true }).click();
		for (const id of [f.workflow.id, duplicate.id])
			await expect
				.poll(
					async () =>
						(await f.request("GET", `/workflows/${id}`)).draft.graph.blocks.find(
							(block: { data: { componentKey?: string } }) =>
								block.data.componentKey === f.card.key,
						).data.componentVersion,
				)
				.toBe(2);
		await evidence(
			"supbrd-plugmod-flows",
			"superboard.flows_components",
			[f.card.id, f.workflow.id, duplicate.id],
			"Updated a component version, observed two outdated instances, synchronized them and read both new draft versions.",
		);
	});
	for (const [locale, label] of [
		["en", "Project identifier"],
		["fr", "Identifiant du projet"],
	] as const) {
		test(`SDK settings use the selected project in ${locale}`, async ({
			authenticatedPage: page,
		}) => {
			await ready(page, `/flows/settings/sdk?lang=${locale}`);
			await expect(page.getByText(label, { exact: true })).toBeVisible();
			await expect(
				page
					.locator("main")
					.getByText(locale === "fr" ? "Organisation" : "Organization", { exact: true }),
			).toHaveCount(0);
			await expect(
				page
					.locator("main")
					.getByText(locale === "fr" ? "Facturation" : "Billing", { exact: true }),
			).toHaveCount(0);
		});
	}
	test("renders the French editor and its workflow migration choices", async ({
		authenticatedPage: page,
	}) => {
		const f = await flowFixture(page);
		await ready(page, `/flows/workflows/${f.workflow.id}?lang=fr`);
		await expect(page.getByRole("tab", { name: "Éditeur", exact: true })).toBeVisible();
		await expect(page.getByText("Le graphe est valide", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Publier", exact: true }).click();
		await expect(
			page.getByText("Terminer les utilisateurs en cours", { exact: true }),
		).toBeVisible();
	});
	for (const theme of ["light", "dark"] as const) {
		test(`preserves the ${theme} workflow editor reference`, async ({
			authenticatedPage: page,
		}) => {
			await page.addInitScript(
				(value) => localStorage.setItem("superboard:autonomy-qa:theme", value),
				theme,
			);
			const f = await flowFixture(page, {
				name: "First-run activation",
				description: "A localized activation card followed by a survey.",
			});
			await ready(page, `/flows/workflows/${f.workflow.id}`);
			await expect(page.locator(".react-flow__node")).toHaveCount(5);
			await page.getByRole("button", { name: "Fit view", exact: true }).click();
			await expect(
				page.getByText("Select a block to edit its settings.", { exact: true }),
			).toBeVisible();
			await expect(page.locator("html")).toHaveClass(new RegExp(theme));
			const bounds = await page.locator(".react-flow").boundingBox();
			expect(bounds?.height).toBeGreaterThan(400);
			if (theme === "dark") {
				const background = await page
					.getByText("Inspector", { exact: true })
					.locator("xpath=ancestor::*[contains(@class,'bg-card')][1]")
					.evaluate((element) => getComputedStyle(element).backgroundColor);
				const channels = background
					.replaceAll(/[^0-9.,]/g, "")
					.split(",")
					.slice(0, 3)
					.map(Number);
				expect(channels.reduce((sum, channel) => sum + channel, 0) / 3).toBeLessThan(100);
			}
			for (const node of await page.locator(".react-flow__node").all())
				await expect(node).toBeInViewport({ ratio: 0.8 });
			await expect(page).toHaveScreenshot(`flows-editor-${theme}.png`, {
				animations: "disabled",
				caret: "hide",
				fullPage: true,
				maxDiffPixelRatio: 0,
			});
		});
	}
});
