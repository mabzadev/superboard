import type { Block, BlockUpdatesPayload } from "@superboard/flows-shared";
import type { Route, WebSocketRoute } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { randomUUID } from "crypto";
import { mockBlocksEndpoint } from "./utils";

let ws: WebSocketRoute | null = null;
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(
    (url) => url.pathname === "/api/v1/flows/ws/sdk/block-updates",
    (_ws) => {
      ws = _ws;
    },
  );
});

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
  test(`${packageName} - should call blocks with correct parameters`, async ({ page }) => {
    await mockBlocksEndpoint(page, []);
    const blocksReq = page.waitForRequest((req) => {
      const body = req.postDataJSON();
      const headers = req.headers();
      return (
        req.url() === "http://localhost:3000/api/v1/flows/v2/sdk/blocks" &&
        /@superboard\/flows-[^@]*@\d+\.\d+.\d+/.test(headers["x-flows-version"] ?? "") &&
        body.projectId === "projectId" &&
        body.userId === "testUserId" &&
        body.environment === "prod" &&
        body.userProperties.email === "test@flows.sh" &&
        body.userProperties.age === 10 &&
        body.language === undefined
      );
    });
    await page.goto(`/${packageName}.html`);
    await blocksReq;
  });
  test(`${packageName} - should call custom apiUrl`, async ({ page }) => {
    await mockBlocksEndpoint(page, []);
    const blocksReq = page.waitForRequest((req) => {
      const body = req.postDataJSON();
      const headers = req.headers();
      return (
        req.url() === "https://custom.api.flows.com/v2/sdk/blocks" &&
        (headers["x-flows-version"] ?? "").startsWith("@superboard/flows-") &&
        body.projectId === "projectId" &&
        body.userId === "testUserId" &&
        body.environment === "prod" &&
        body.userProperties.email === "test@flows.sh" &&
        body.userProperties.age === 10 &&
        body.language === undefined
      );
    });
    const urlParams = new URLSearchParams();
    urlParams.set("apiUrl", "https://custom.api.flows.com");
    await page.goto(`/${packageName}.html?${urlParams.toString()}`);
    await blocksReq;
  });
  test(`${packageName} - should apply update messages after /blocks is received`, async ({
    page,
  }) => {
    let blocksRoute: Route | null = null;
    await page.route("**/v2/sdk/blocks", (route) => {
      blocksRoute = route;
    });
    await page.goto(`/${packageName}.html`);
    await expect(page.locator(".current-blocks")).toHaveText(JSON.stringify([]));
    const block = getBlock();
    const payload: BlockUpdatesPayload = {
      exitedBlockIds: [],
      updatedBlocks: [block],
    };
    ws?.send(JSON.stringify(payload));
    await expect(page.getByText("Hello world", { exact: true })).toBeHidden();
    await (blocksRoute as Route | null)?.fulfill({ json: { blocks: [] } });
    await expect(page.getByText("Hello world", { exact: true })).toBeVisible();
  });
};

test("react - should refetch blocks on userProperties change", async ({ page }) => {
  await mockBlocksEndpoint(page, []);
  const firstBlocksReq = page.waitForRequest((req) => {
    const body = req.postDataJSON();
    return (
      req.url() === "http://localhost:3000/api/v1/flows/v2/sdk/blocks" && body.userProperties.count === 0
    );
  });
  await page.goto(`/react.html`);
  await firstBlocksReq;
  const secondBlocksReq = page.waitForRequest((req) => {
    const body = req.postDataJSON();
    return (
      req.url() === "http://localhost:3000/api/v1/flows/v2/sdk/blocks" && body.userProperties.count === 1
    );
  });
  await page.getByText("Increment", { exact: true }).click();
  await secondBlocksReq;
});

run("js");
run("react");
