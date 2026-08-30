import type { Block, BlockUpdatesPayload } from "@superboard/flows-shared";
import type { WebSocketRoute } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { randomUUID } from "crypto";
import { mockBlocksEndpoint } from "./utils";

const getBlock = (): Block => ({
  id: randomUUID(),
  workflowId: randomUUID(),
  type: "component",
  componentType: "BasicsV2Modal",
  data: { title: "Hello world", body: "" },
  exitNodes: [],
  slottable: false,
  propertyMeta: [],
});

const run = (packageName: string) => {
  test.describe(`mocked websocket`, () => {
    let ws: WebSocketRoute | null = null;
    test.beforeEach(async ({ page }) => {
      await page.routeWebSocket(
        (url) => url.pathname === "/api/v1/flows/ws/sdk/block-updates",
        (_ws) => {
          ws = _ws;
        },
      );
    });

    test(`${packageName} - should display block that is received through websocket`, async ({
      page,
    }) => {
      const block = getBlock();
      await mockBlocksEndpoint(page, []);
      await page.goto(`/${packageName}.html`);
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.getByText("Hello world", { exact: true })).toBeHidden();
      const payload: BlockUpdatesPayload = {
        exitedBlockIds: [],
        updatedBlocks: [block],
      };
      (ws as unknown as WebSocketRoute).send(JSON.stringify(payload));
      await expect(page.getByText("Hello world", { exact: true })).toBeVisible();
    });
    test(`${packageName} - should exit block that is received through websocket`, async ({
      page,
    }) => {
      const block = getBlock();
      await mockBlocksEndpoint(page, [block]);
      await page.goto(`/${packageName}.html`);
      await expect(page.getByText("Hello world", { exact: true })).toBeVisible();
      const payload: BlockUpdatesPayload = {
        exitedBlockIds: [block.id],
        updatedBlocks: [],
      };
      (ws as unknown as WebSocketRoute).send(JSON.stringify(payload));
      await expect(page.getByText("Hello world", { exact: true })).toBeHidden();
    });
    test(`${packageName} - should update block`, async ({ page }) => {
      const block = getBlock();
      await mockBlocksEndpoint(page, [block]);
      await page.goto(`/${packageName}.html`);
      await expect(page.getByText("Hello world", { exact: true })).toBeVisible();
      await expect(page.getByText("Updated body", { exact: true })).toBeHidden();
      const payload: BlockUpdatesPayload = {
        exitedBlockIds: [],
        updatedBlocks: [{ ...block, data: { ...block.data, body: "Updated body" } }],
      };
      (ws as unknown as WebSocketRoute).send(JSON.stringify(payload));
      await expect(page.getByText("Hello world", { exact: true })).toHaveCount(1);
      await expect(page.getByText("Updated body", { exact: true })).toBeVisible();
    });
  });

  test.describe(`real websocket`, () => {
    test(`${packageName} - should establish websocket connection`, async ({ page }) => {
      await mockBlocksEndpoint(page, []);
      const wsPromise = page.waitForEvent("websocket");
      const blocksPromise = page.waitForRequest((req) => {
        return req.url() === "http://localhost:3000/api/v1/flows/v2/sdk/blocks";
      });
      await page.goto(`/${packageName}.html`);
      await Promise.all([wsPromise, blocksPromise]);
    });
  });
};

run("js");
run("react");
