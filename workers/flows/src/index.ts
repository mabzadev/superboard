import { Hono, type Context } from "hono";
import { inspectSqlDatabaseAndSchemaHealth } from "@superboard/contracts/health";
import { errorResponse, failure } from "./http/errors";
import { requireProjectContext, type FlowApp } from "./http/auth";
import { readJsonObject } from "./http/validation";
import { replayProjectMutation } from "./http/idempotency";
import {
  createEnvironment,
  ensureFlowProject,
  getFlowProject,
  listEnvironments,
  listLanguageGroups,
  rotateEnvironmentKey,
  saveLanguageGroup,
} from "./projects/service";
import {
  activateWorkflow,
  createWorkflow,
  deactivateWorkflow,
  duplicateWorkflow,
  getVersion,
  getWorkflow,
  listWorkflows,
  publishWorkflow,
  saveDraft,
  saveTranslations,
  updateWorkflow,
} from "./workflows/service";
import {
  createComponent,
  createLibrary,
  listComponents,
  syncComponentInstances,
  updateComponent,
  updateLibrary,
} from "./components/service";
import { resolveCommercePresentation } from "./commerce/service";
import {
  createLaunchpadGroup,
  deleteLaunchpadGroup,
  getLaunchpad,
  setLaunchpadWorkflows,
  updateLaunchpadGroup,
} from "./launchpad/service";
import {
  exportSurveyCsv,
  flowOverview,
  getUser,
  listUsers,
  resetUserWorkflow,
  surveyAnalytics,
  workflowAnalytics,
} from "./analytics/service";
import {
  sdkBlocks,
  sdkEvent,
  sdkSurvey,
  sdkWebSocket,
  sdkWorkflows,
} from "./sdk/service";
import { consumeFlowEvents } from "./queue/consumer";
import { flowWorkflowInstanceId } from "./workflows/instance-id";
import { legacyRequest } from "./legacy/service";
import type { Env } from "./types";
import { hashFlowUserId } from "./services/crypto";

export { FlowUserRuntime } from "./runtime/user-runtime";
export { FlowRealtimeHub } from "./runtime/realtime-hub";
export { FlowDelayExecution } from "./workflows/delay";
export { FlowMaintenanceExecution } from "./workflows/maintenance";

const app = new Hono<FlowApp>();

app.onError((error, context) => errorResponse(error, context));
app.options("*", (context) =>
  new Response(null, {
    status: 204,
    headers: corsHeaders(context.req.header("origin")),
  }),
);
app.get("/internal/v1/health", health);
app.get("/health", health);

for (const prefix of ["", "/api/v1/flows"] as const) {
  app.post(`${prefix}/v2/sdk/blocks`, (context) =>
    sdkBlocks(context.req.raw, context.env),
  );
  app.post(`${prefix}/v2/sdk/workflows`, (context) =>
    sdkWorkflows(context.req.raw, context.env),
  );
  app.post(`${prefix}/v2/sdk/events`, (context) =>
    sdkEvent(context.req.raw, context.env),
  );
  app.post(`${prefix}/v2/sdk/survey`, (context) =>
    sdkSurvey(context.req.raw, context.env),
  );
  app.get(`${prefix}/ws/sdk/block-updates`, (context) =>
    sdkWebSocket(context.req.raw, context.env),
  );
}

app.use("/internal/v1/projects/:projectRef", requireProjectContext());
app.use("/internal/v1/projects/:projectRef/*", requireProjectContext());
app.use("/internal/v1/legacy/*", requireProjectContext());
app.use("/internal/v1/legacy/*", async (context, next) => {
  context.set("flowProject", await ensureFlowProject(context));
  await next();
});
app.all("/internal/v1/legacy/paywalls", (context) =>
  legacyRequest(context, "paywalls"),
);
app.all("/internal/v1/legacy/paywalls/*", (context) =>
  legacyRequest(context, "paywalls"),
);
app.all("/internal/v1/legacy/onboardings", (context) =>
  legacyRequest(context, "onboardings"),
);
app.all("/internal/v1/legacy/onboardings/*", (context) =>
  legacyRequest(context, "onboardings"),
);

const base = "/internal/v1/projects/:projectRef";
app.use(`${base}/*`, async (context, next) => {
  if (context.req.param("projectRef") !== context.get("project").projectRef) {
    throw failure(
      "flow_project_context_mismatch",
      "Signed project reference does not match route",
      403,
    );
  }
  context.set("flowProject", await ensureFlowProject(context));
  await next();
});
app.use(`${base}/*`, replayProjectMutation());

app.get(`${base}/project`, async (context) =>
  data(await getFlowProject(context)),
);

app.post(`${base}/cutover/user-hashes`, async (context) => {
  const input = await body(context);
  if (
    !Array.isArray(input.user_ids) ||
    input.user_ids.length < 1 ||
    input.user_ids.length > 500 ||
    input.user_ids.some(
      (value) => typeof value !== "string" || value.length < 1 || value.length > 512,
    )
  ) {
    throw failure(
      "flow_cutover_user_ids_invalid",
      "user_ids must contain between 1 and 500 non-empty strings",
      422,
    );
  }
  const project = context.get("flowProject");
  const userIds = input.user_ids as string[];
  return data({
    items: await Promise.all(
      userIds.map(async (userId) => ({
        user_id: userId,
        user_id_hash: await hashFlowUserId(
          context.env,
          project.projectRef,
          userId,
        ),
      })),
    ),
  });
});

app.get(`${base}/overview`, async (context) =>
  data(await flowOverview(context)),
);

app.get(`${base}/environments`, async (context) =>
  data(await listEnvironments(context)),
);
app.post(`${base}/environments`, async (context) =>
  data(
    await createEnvironment(context, await body(context)),
    201,
  ),
);
app.post(
  `${base}/environments/:environmentId/rotate-key`,
  async (context) =>
    data(
      await rotateEnvironmentKey(
        context,
        context.req.param("environmentId"),
      ),
    ),
);
app.get(`${base}/localization`, async (context) =>
  data(await listLanguageGroups(context)),
);
app.put(`${base}/localization`, async (context) =>
  data(await saveLanguageGroup(context, await body(context))),
);
app.post(`${base}/localization`, async (context) =>
  data(
    await saveLanguageGroup(context, await body(context)),
    201,
  ),
);

const projectResource = base;

app.get(`${projectResource}/workflows`, async (context) =>
  data(await listWorkflows(context)),
);
app.post(`${projectResource}/workflows`, async (context) =>
  data(
    await createWorkflow(
      context,
      await body(context),
    ),
    201,
  ),
);
const workflow = `${projectResource}/workflows/:workflowId`;
app.get(workflow, async (context) =>
  data(
    await getWorkflow(
      context,
      context.req.param("workflowId"),
    ),
  ),
);
app.patch(workflow, async (context) =>
  data(
    await updateWorkflow(
      context,
      context.req.param("workflowId"),
      await body(context),
    ),
  ),
);
app.put(workflow, async (context) =>
  data(
    await updateWorkflow(
      context,
      context.req.param("workflowId"),
      await body(context),
    ),
  ),
);
app.put(`${workflow}/draft`, async (context) =>
  data(
    await saveDraft(
      context,
      context.req.param("workflowId"),
      await body(context),
    ),
  ),
);
app.post(`${workflow}/publish`, async (context) =>
  data(
    await publishWorkflow(
      context,
      context.req.param("workflowId"),
      await body(context),
    ),
    201,
  ),
);
app.get(`${workflow}/versions/:versionId`, async (context) =>
  data(
    await getVersion(
      context,
      context.req.param("workflowId"),
      context.req.param("versionId"),
    ),
  ),
);
app.post(`${workflow}/duplicate`, async (context) =>
  data(
    await duplicateWorkflow(
      context,
      context.req.param("workflowId"),
      await body(context),
    ),
    201,
  ),
);
app.put(`${workflow}/translations`, async (context) =>
  data(
    await saveTranslations(
      context,
      context.req.param("workflowId"),
      await body(context),
    ),
  ),
);
app.post(`${workflow}/releases`, async (context) =>
  data(
    await activateWorkflow(
      context,
      context.req.param("workflowId"),
      await body(context),
    ),
  ),
);
app.delete(
  `${workflow}/releases/:environmentId`,
  async (context) => {
    await deactivateWorkflow(
      context,
      context.req.param("workflowId"),
      context.req.param("environmentId"),
    );
    return empty();
  },
);
app.get(`${workflow}/analytics`, async (context) =>
  data(
    await workflowAnalytics(
      context,
      context.req.param("workflowId"),
    ),
  ),
);

app.get(`${projectResource}/components`, async (context) =>
  data(await listComponents(context)),
);
app.post(`${projectResource}/component-libraries`, async (context) =>
  data(
    await createLibrary(
      context,
      await body(context),
    ),
    201,
  ),
);
app.patch(
  `${projectResource}/component-libraries/:libraryId`,
  async (context) =>
    data(
      await updateLibrary(
        context,
        context.req.param("libraryId"),
        await body(context),
      ),
    ),
);
app.post(`${projectResource}/components`, async (context) =>
  data(
    await createComponent(
      context,
      await body(context),
    ),
    201,
  ),
);
app.patch(`${projectResource}/components/:componentId`, async (context) =>
  data(
    await updateComponent(
      context,
      context.req.param("componentId"),
      await body(context),
    ),
  ),
);
app.post(
  `${projectResource}/components/:componentId/sync`,
  async (context) =>
    data(
      await syncComponentInstances(
        context,
        context.req.param("componentId"),
      ),
    ),
);

app.get(`${projectResource}/launchpad`, async (context) =>
  data(await getLaunchpad(context)),
);
app.post(`${projectResource}/launchpad/groups`, async (context) =>
  data(
    await createLaunchpadGroup(
      context,
      await body(context),
    ),
    201,
  ),
);
app.patch(
  `${projectResource}/launchpad/groups/:groupId`,
  async (context) =>
    data(
      await updateLaunchpadGroup(
        context,
        context.req.param("groupId"),
        await body(context),
      ),
    ),
);
app.put(
  `${projectResource}/launchpad/groups/:groupId/workflows`,
  async (context) =>
    data(
      await setLaunchpadWorkflows(
        context,
        context.req.param("groupId"),
        await body(context),
      ),
    ),
);
app.delete(
  `${projectResource}/launchpad/groups/:groupId`,
  async (context) => {
    await deleteLaunchpadGroup(
      context,
      context.req.param("groupId"),
    );
    return empty();
  },
);

app.get(`${projectResource}/users`, async (context) =>
  data(await listUsers(context)),
);
app.get(`${projectResource}/users/:userHash`, async (context) =>
  data(
    await getUser(
      context,
      context.req.param("userHash"),
    ),
  ),
);
app.post(`${projectResource}/users/:userHash/reset`, async (context) =>
  data(
    await resetUserWorkflow(
      context,
      context.req.param("userHash"),
      await body(context),
    ),
  ),
);
app.get(`${projectResource}/surveys/:surveyId/analytics`, async (context) =>
  data(
    await surveyAnalytics(
      context,
      context.req.param("surveyId"),
    ),
  ),
);
app.post(`${projectResource}/surveys/:surveyId/export`, async (context) =>
  data(
    await exportSurveyCsv(
      context,
      context.req.param("surveyId"),
    ),
    202,
  ),
);
app.post(`${base}/commerce/resolve`, async (context) =>
  data(await resolveCommercePresentation(context, await body(context))),
);

async function health(context: Context<FlowApp>): Promise<Response> {
  try {
    const schema = await inspectSqlDatabaseAndSchemaHealth(
      context.env.DB,
      context.env.D1_EXPECTED_MIGRATION,
    );
    const current = schema.status === "current";
    return data(
      {
        service: "flows",
        version: "v1",
        status: current ? "ok" : "degraded",
        storage: "d1+durable-objects+queue+r2+workflows",
        schema,
      },
      current ? 200 : 503,
    );
  } catch {
    return data(
      {
        service: "flows",
        version: "v1",
        status: "degraded",
        reason: "database_health_unavailable",
      },
      503,
    );
  }
}

async function body(context: Context<FlowApp>): Promise<Record<string, unknown>> {
  return readJsonObject(context.req.raw);
}

function data(value: unknown, status = 200): Response {
  return Response.json({ data: value }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function empty(): Response {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

function corsHeaders(origin?: string): HeadersInit {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      "content-type,idempotency-key,x-flows-version,x-superboard-flows-sdk-key",
    "access-control-max-age": "86400",
  };
}

const worker = {
  fetch: app.fetch,
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    await consumeFlowEvents(batch, env);
  },
  async scheduled(
    controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
  ): Promise<void> {
    const projectRows = await env.DB.prepare(
      "SELECT project_id FROM flow_projects ORDER BY project_id",
    ).all<{ project_id: number }>();
    context.waitUntil(
      Promise.all(
        projectRows.results.flatMap((row) =>
          ([
            "purge",
            "rebuild-rollups",
          ] as const).map(async (operation) => {
            const businessId = [
              row.project_id,
              controller.scheduledTime,
              operation,
            ].join(":");
            const id = await flowWorkflowInstanceId(
              "flows-maintenance",
              businessId,
            );
            try {
              await env.FLOW_MAINTENANCE_EXECUTION.create({
                id,
                params: {
                  id,
                  projectId: Number(row.project_id),
                  operation,
                },
              });
            } catch (error) {
              if (!/already exists|instance.*exists/iu.test(
                error instanceof Error ? error.message : String(error),
              )) throw error;
            }
          }),
        ),
      ).then(() => undefined),
    );
  },
} satisfies ExportedHandler<Env>;

export default worker;
