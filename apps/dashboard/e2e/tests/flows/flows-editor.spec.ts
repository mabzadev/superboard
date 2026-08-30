import { expect, test } from "../../fixtures/base-fixtures";
import { FLOW_WORKFLOW_ID, setupFlowsMocks } from "../../fixtures/flows-mocks";

test.describe("Flows workflow editor", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
  });

  test("edits, validates, saves and publishes a workflow", async ({
    authenticatedPage: page,
  }) => {
    const state = await setupFlowsMocks(page);
    await page.goto(`/flows/workflows/${FLOW_WORKFLOW_ID}`);

    await expect(page.getByText("First-run activation").first()).toBeVisible();
    await expect(page.locator(".react-flow__node")).toHaveCount(5);
    await expect(page.getByText("Graph is valid")).toBeVisible();

    await page.getByRole("button", { name: "Add block" }).click();
    await page.getByPlaceholder("Search blocks").fill("delay");
    await page.getByRole("button", { name: /^Delay/ }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(6);
    await expect(page.getByText("Runtime properties")).toBeVisible();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(5);
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(6);

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => state.saves.length).toBe(1);
    expect(state.saves[0]).toMatchObject({ revision: 7 });

    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByPlaceholder("What changed?")
      .fill("Published from Playwright");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Publish" })
      .click();
    await expect.poll(() => state.publishes.length).toBe(1);
    await expect.poll(() => state.releases.length).toBe(1);
    expect(state.releases[0]).toMatchObject({
      environment_id: "flow-env-production",
      version_id: "flow-version-004",
    });
    await expect(page.getByText(/flow-release-test-001/)).toBeVisible();
  });

  test("shows workflow and survey analytics without affecting commerce metrics", async ({
    authenticatedPage: page,
  }) => {
    await setupFlowsMocks(page);
    await page.goto(`/flows/workflows/${FLOW_WORKFLOW_ID}`);
    await page.getByRole("tab", { name: "Analytics" }).click();

    await expect(page.getByText("Event totals")).toBeVisible();
    await expect(page.getByText("Survey results")).toBeVisible();
    await expect(page.getByText("4.42")).toBeVisible();
    await expect(page.getByText("62%")).toBeVisible();
    await expect(page.getByText("Link conversion")).toBeVisible();
  });

  test("creates exact SDK blocks from the versioned component catalog", async ({
    authenticatedPage: page,
  }) => {
    const state = await setupFlowsMocks(page);
    await page.goto(`/flows/workflows/${FLOW_WORKFLOW_ID}`);

    await page.getByRole("button", { name: "Add block" }).click();
    await page.getByPlaceholder("Search blocks").fill("modal");
    await page
      .getByRole("button", { name: /^Modal Basics V2 · Component$/ })
      .click();

    await expect(page.locator(".react-flow__node")).toHaveCount(6);
    await expect(page.getByText("BasicsV2Modal")).toBeVisible();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => state.saves.length).toBe(1);
    expect(
      state.graph.blocks.find((block) => block.data.componentKey === "modal")
    ).toMatchObject({
      type: "component",
      componentType: "BasicsV2Modal",
      componentLibraryName: "Basics V2",
      data: { componentKey: "modal", componentVersion: 1 },
      exitNodes: ["continue", "close"],
    });
  });

  test("shows outdated component instances before explicit synchronization", async ({
    authenticatedPage: page,
  }) => {
    await setupFlowsMocks(page);
    await page.goto("/flows/components");

    const card = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "card · v1" });
    await expect(card.getByText("Outdated instances: 2")).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Update instances (2)" })
    ).toBeVisible();
  });

  test("uses the current project without a separate workspace or commercial settings", async ({
    authenticatedPage: page,
  }) => {
    await setupFlowsMocks(page);
    await page.goto("/flows/settings/sdk");

    await expect(
      page.getByText("Project identifier", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("projectId", { exact: false }).first()
    ).toBeVisible();
    await expect(page.getByText("Organization", { exact: true })).toHaveCount(
      0
    );
    await expect(page.getByText("Members", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Billing", { exact: true })).toHaveCount(0);
  });

  test("keeps the project-only experience in French", async ({
    authenticatedPage: page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "language", {
        configurable: true,
        get: () => "fr-FR",
      });
    });
    await setupFlowsMocks(page);
    await page.goto("/flows/settings/sdk");

    await expect(
      page.getByText("Identifiant du projet", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("Organisation", { exact: true })).toHaveCount(
      0
    );
    await expect(page.getByText("Membres", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Facturation", { exact: true })).toHaveCount(0);
  });

  test("renders the French editor and exact migration contract label", async ({
    authenticatedPage: page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "language", {
        configurable: true,
        get: () => "fr-FR",
      });
    });
    await setupFlowsMocks(page);
    await page.goto(`/flows/workflows/${FLOW_WORKFLOW_ID}`);

    await expect(page.getByRole("tab", { name: "Éditeur" })).toBeVisible();
    await expect(page.getByText("Le graphe est valide")).toBeVisible();
    await page.getByRole("button", { name: "Publier" }).click();
    await expect(
      page.getByText("Terminer les utilisateurs en cours")
    ).toBeVisible();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`matches the ${theme} workflow editor reference`, async ({
      authenticatedPage: page,
    }) => {
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem("theme", selectedTheme);
      }, theme);
      await setupFlowsMocks(page);
      await page.goto(`/flows/workflows/${FLOW_WORKFLOW_ID}`);
      await expect(page.locator(".react-flow__node")).toHaveCount(5);
      await page.locator(".react-flow__controls-fitview").click();
      await expect(
        page.getByText("Select a block to edit its settings.")
      ).toBeVisible();
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await expect(
        page.getByText("Organization", { exact: true })
      ).toHaveCount(0);
      await expect(page.getByText("Members", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Billing", { exact: true })).toHaveCount(0);

      await expect(page).toHaveScreenshot(`flows-editor-${theme}.png`, {
        animations: "disabled",
        caret: "hide",
        fullPage: true,
        maxDiffPixelRatio: 0,
      });
    });
  }
});
