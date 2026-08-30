import test from "@playwright/test";
import { mockBlocksEndpoint } from "./utils";

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(
    (url) => url.pathname === "/api/v1/flows/ws/sdk/block-updates",
    () => {},
  );

  await mockBlocksEndpoint(page, []);
});

const run = (packageName: string) => {
  test(`${packageName} - resetAllWorkflowsProgress should call event endpoint`, async ({
    page,
  }) => {
    await page.goto(`/${packageName}.html`);

    const req = page.waitForRequest((req) => {
      const body = req.postDataJSON();
      const headers = req.headers();
      return (
        req.url() === "http://localhost:3000/api/v1/flows/v2/sdk/events" &&
        /@superboard\/flows-[^@]*@\d+\.\d+.\d+/.test(headers["x-flows-version"] ?? "") &&
        body.projectId === "projectId" &&
        body.userId === "testUserId" &&
        body.environment === "prod" &&
        body.name === "reset-progress" &&
        body.workflowId === undefined
      );
    });
    await page.getByRole("button", { name: "resetAllWorkflowsProgress" }).click();
    await req;
  });
  test(`${packageName} - resetWorkflowProgress should call event endpoint`, async ({ page }) => {
    await page.goto(`/${packageName}.html`);

    const req = page.waitForRequest((req) => {
      const body = req.postDataJSON();
      const headers = req.headers();
      return (
        req.url() === "http://localhost:3000/api/v1/flows/v2/sdk/events" &&
        /@superboard\/flows-[^@]*@\d+\.\d+.\d+/.test(headers["x-flows-version"] ?? "") &&
        body.projectId === "projectId" &&
        body.userId === "testUserId" &&
        body.environment === "prod" &&
        body.name === "reset-progress" &&
        body.workflowId === "my-workflow-id"
      );
    });
    await page.getByRole("button", { name: "resetWorkflowProgress" }).click();
    await req;
  });
  test(`${packageName} - startWorkflow should call event endpoint`, async ({ page }) => {
    await page.goto(`/${packageName}.html`);

    const req = page.waitForRequest((req) => {
      const body = req.postDataJSON();
      const headers = req.headers();
      return (
        req.url() === "http://localhost:3000/api/v1/flows/v2/sdk/events" &&
        /@superboard\/flows-[^@]*@\d+\.\d+.\d+/.test(headers["x-flows-version"] ?? "") &&
        body.projectId === "projectId" &&
        body.userId === "testUserId" &&
        body.environment === "prod" &&
        body.name === "workflow-start" &&
        body.blockKey === "my-start-block"
      );
    });
    await page.getByRole("button", { name: "startWorkflow" }).click();
    await req;
  });
  test(`${packageName} - fetchWorkflows should call api`, async ({ page }) => {
    await page.goto(`/${packageName}.html`);
    const req = page.waitForRequest((req) => {
      const body = req.postDataJSON();
      const headers = req.headers();
      return (
        req.url() === "http://localhost:3000/api/v1/flows/v2/sdk/workflows" &&
        /@superboard\/flows-[^@]*@\d+\.\d+.\d+/.test(headers["x-flows-version"] ?? "") &&
        body.userId === "testUserId" &&
        body.environment === "prod" &&
        body.projectId === "projectId"
      );
    });
    await page.getByText("fetchWorkflows", { exact: true }).click();
    await req;
  });
};

run("js");
run("react");
