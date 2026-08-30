import type { Page, Route } from "@playwright/test";

import { TEST_PROJECT } from "./test-data";

export const FLOW_WORKFLOW_ID = "flow-welcome-001";
export const FLOW_ENVIRONMENT_ID = "flow-env-production";
export const FLOW_SURVEY_ID = "flow-survey-001";

const now = "2026-08-13T08:00:00.000Z";

const initialGraph = {
  schemaVersion: 1 as const,
  blocks: [
    {
      id: "flow-start-001",
      key: "eligible_users",
      type: "start",
      name: "Eligible users",
      description: "Starts automatically for matching product users.",
      position: { x: 80, y: 160 },
      data: {},
      propertyMeta: [],
      exitNodes: ["default"],
      conditions: [
        {
          key: "plan",
          data_type: "string",
          operator: "equals",
          value: ["pro"],
        },
      ],
    },
    {
      id: "flow-card-001",
      key: "welcome_card",
      type: "component",
      name: "Welcome card",
      description: "Introduce the workspace and guide the first action.",
      componentType: "BasicsV2Card",
      componentLibraryName: "Basics V2",
      position: { x: 390, y: 80 },
      data: {
        componentKey: "card",
        componentVersion: 1,
        title: "Welcome to SuperBoard",
        body: "Create your first product experience.",
      },
      propertyMeta: [
        {
          key: "continue",
          type: "action",
          value: { type: "exit", target: "continue" },
        },
      ],
      exitNodes: ["continue", "dismiss"],
      slottable: true,
      slotId: "dashboard-overlay",
      slotIndex: 0,
    },
    {
      id: FLOW_SURVEY_ID,
      key: "activation_survey",
      type: "survey",
      name: "Activation survey",
      description: "Capture activation feedback before completing.",
      componentType: "BasicsV2SurveyPopover",
      componentLibraryName: "Basics V2",
      position: { x: 730, y: 220 },
      data: {
        componentKey: "survey-popover",
        componentVersion: 1,
        title: "One last question",
      },
      propertyMeta: [],
      exitNodes: ["submit", "dismiss"],
      surveyQuestions: [
        {
          id: "question-rating",
          type: "rating",
          title: "How useful was this tour?",
          optional: false,
          displayType: "stars",
          minValue: 1,
          maxValue: 5,
        },
      ],
    },
    {
      id: "flow-end-001",
      key: "completed",
      type: "end",
      name: "Completed",
      description: "Complete every active branch.",
      position: { x: 1080, y: 160 },
      data: {},
      propertyMeta: [],
      exitNodes: [],
    },
    {
      id: "flow-note-001",
      key: "editor_note",
      type: "note",
      name: "Activation notes",
      description: "Editor-only release checklist.",
      position: { x: 430, y: 390 },
      data: { text: "Verify the French copy before production." },
      propertyMeta: [],
      exitNodes: [],
      notes: "Verify the French copy before production.",
    },
  ],
  paths: [
    {
      id: "path-start-card",
      sourceBlockId: "flow-start-001",
      sourceExitNode: "default",
      targetBlockId: "flow-card-001",
      label: "eligible",
    },
    {
      id: "path-card-survey",
      sourceBlockId: "flow-card-001",
      sourceExitNode: "continue",
      targetBlockId: FLOW_SURVEY_ID,
      label: "continue",
    },
    {
      id: "path-card-end",
      sourceBlockId: "flow-card-001",
      sourceExitNode: "dismiss",
      targetBlockId: "flow-end-001",
      label: "dismiss",
      triggerOnly: true,
    },
    {
      id: "path-survey-end",
      sourceBlockId: FLOW_SURVEY_ID,
      sourceExitNode: "submit",
      targetBlockId: "flow-end-001",
      label: "submit",
    },
  ],
};

export type FlowsMockState = {
  graph: typeof initialGraph;
  revision: number;
  saves: unknown[];
  publishes: unknown[];
  releases: unknown[];
  translations: unknown[];
};

export async function setupFlowsMocks(page: Page): Promise<FlowsMockState> {
  const state: FlowsMockState = {
    graph: structuredClone(initialGraph),
    revision: 7,
    saves: [],
    publishes: [],
    releases: [],
    translations: [],
  };
  const base = `/api/v1/flows/projects/${TEST_PROJECT.id}`;
  const workflow = `${base}/workflows/${FLOW_WORKFLOW_ID}`;

  await page.route(`**${base}/environments`, async (route) =>
    json(route, {
      data: {
        items: [
          {
            id: FLOW_ENVIRONMENT_ID,
            name: "Production",
            key: "production",
            kind: "production",
            active: true,
            allow_draft: false,
            created_at: now,
          },
          {
            id: "flow-env-test",
            name: "Test",
            key: "test",
            kind: "test",
            active: true,
            allow_draft: true,
            created_at: now,
          },
        ],
      },
    })
  );
  await page.route(`**${base}/localization`, async (route) =>
    json(route, {
      data: {
        items: [
          {
            id: "language-default",
            name: "Default",
            default_locale: "en",
            locales: ["en", "fr"],
            fallbacks: { fr: "en" },
          },
        ],
      },
    })
  );
  await page.route(`**${base}/components`, async (route) =>
    json(route, {
      data: {
        libraries: [
          {
            id: "library-basics-v2",
            name: "Basics V2",
            identifier: "basics-v2",
            enabled: true,
            source: "basics-v2",
          },
        ],
        items: [
          componentDefinition(
            "survey-popover",
            "Survey Popover",
            "survey-component",
            "BasicsV2SurveyPopover",
            ["submit", "close"]
          ),
          componentDefinition(
            "floating-checklist",
            "Floating Checklist",
            "component",
            "BasicsV2FloatingChecklist",
            ["complete", "close"]
          ),
          componentDefinition(
            "card",
            "Card",
            "component",
            "BasicsV2Card",
            ["continue", "close"],
            true,
            2
          ),
          componentDefinition(
            "tour-card",
            "Card",
            "tour-component",
            "BasicsV2Card",
            [],
            true
          ),
          componentDefinition("hint", "Hint", "component", "BasicsV2Hint", [
            "continue",
            "close",
          ]),
          componentDefinition(
            "tour-hint",
            "Hint",
            "tour-component",
            "BasicsV2Hint",
            []
          ),
          componentDefinition("modal", "Modal", "component", "BasicsV2Modal", [
            "continue",
            "close",
          ]),
          componentDefinition(
            "tour-modal",
            "Modal",
            "tour-component",
            "BasicsV2Modal",
            []
          ),
          componentDefinition(
            "tooltip",
            "Tooltip",
            "component",
            "BasicsV2Tooltip",
            ["continue", "close"]
          ),
          componentDefinition(
            "tour-tooltip",
            "Tooltip",
            "tour-component",
            "BasicsV2Tooltip",
            []
          ),
        ],
      },
    })
  );
  await page.route(`**${workflow}`, async (route) =>
    json(route, {
      data: {
        id: FLOW_WORKFLOW_ID,
        identifier: "first-run-activation",
        name: "First-run activation",
        description: "A localized activation card followed by a survey.",
        frequency: "once",
        status: "active",
        origin: "flows",
        draft_revision: state.revision,
        created_at: now,
        updated_at: now,
        draft: {
          revision: state.revision,
          graph: state.graph,
          validation: { valid: true, issues: [] },
          updated_at: now,
        },
        versions: [
          {
            id: "flow-version-003",
            version: 3,
            changelog: "Survey copy",
            migration_strategy: "finish-current",
            published_at: now,
          },
        ],
        releases: [
          {
            environment_id: FLOW_ENVIRONMENT_ID,
            environment_name: "Production",
            environment_key: "production",
            workflow_version_id: "flow-version-003",
            version: 3,
            use_draft: false,
            active: true,
            activated_at: now,
          },
        ],
        translations: [
          {
            block_key: "welcome_card",
            property_key: "title",
            locale: "fr",
            value: "Bienvenue sur SuperBoard",
          },
        ],
      },
    })
  );
  await page.route(`**${workflow}/draft`, async (route) => {
    const payload = route.request().postDataJSON() as {
      graph: typeof initialGraph;
      revision: number;
    };
    state.saves.push(payload);
    state.graph = payload.graph;
    state.revision = payload.revision + 1;
    await json(route, {
      data: {
        workflow_id: FLOW_WORKFLOW_ID,
        revision: state.revision,
        graph: state.graph,
        validation: { valid: true, issues: [] },
        updated_at: now,
      },
    });
  });
  await page.route(`**${workflow}/publish`, async (route) => {
    state.publishes.push(route.request().postDataJSON());
    await json(route, {
      data: {
        id: "flow-version-004",
        version: 4,
        changelog: "Published from Playwright",
        migration_strategy: "finish-current",
        published_at: now,
      },
    });
  });
  await page.route(`**${workflow}/releases`, async (route) => {
    state.releases.push(route.request().postDataJSON());
    await json(route, {
      data: {
        workflow_id: FLOW_WORKFLOW_ID,
        environment_id: FLOW_ENVIRONMENT_ID,
        version_id: "flow-version-004",
        use_draft: false,
        active: true,
        activated_at: now,
        migration_execution_id: "flow-release-test-001",
      },
    });
  });
  await page.route(`**${base}/components/component-card/sync`, async (route) =>
    json(route, {
      data: {
        id: "component-card",
        component_key: "card",
        version: 1,
        synchronized: true,
      },
    })
  );
  await page.route(`**${workflow}/translations`, async (route) => {
    state.translations.push(route.request().postDataJSON());
    await json(route, {
      data: { workflow_id: FLOW_WORKFLOW_ID, count: 1, updated_at: now },
    });
  });
  await page.route(`**${workflow}/analytics`, async (route) =>
    json(route, {
      data: {
        from: "2026-07-14T08:00:00.000Z",
        to: now,
        environment_id: null,
        totals: [
          { event_name: "block-activated", count: 720, users: 612 },
          { event_name: "survey-submit", count: 381, users: 373 },
          { event_name: "workflow-exit", count: 544, users: 530 },
        ],
        timeline: [],
        blocks: [
          {
            block_id: "flow-card-001",
            block_key: "welcome_card",
            event_name: "block-activated",
            count: 720,
            users: 612,
          },
          {
            block_id: FLOW_SURVEY_ID,
            block_key: "activation_survey",
            event_name: "survey-submit",
            count: 381,
            users: 373,
          },
        ],
      },
    })
  );
  await page.route(
    `**${base}/surveys/${FLOW_SURVEY_ID}/analytics`,
    async (route) =>
      json(route, {
        data: {
          survey_id: FLOW_SURVEY_ID,
          from: "2026-07-14T08:00:00.000Z",
          to: now,
          environment_id: null,
          summary: { shown: 612, responses: 381, completion: 0.6225 },
          numeric: {
            count: 381,
            average: 4.42,
            median: 5,
            standard_deviation: 0.74,
          },
          distributions: { "1": 4, "2": 8, "3": 42, "4": 108, "5": 219 },
          links: { clicks: 96, conversion: 0.252 },
          responses: [],
        },
      })
  );

  return state;
}

async function json(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function componentDefinition(
  key: string,
  name: string,
  templateType: "component" | "tour-component" | "survey-component",
  componentType: string,
  exitNodes: string[],
  slottable = false,
  outdatedInstances = 0
) {
  return {
    id: `component-${key}`,
    library_id: "library-basics-v2",
    library_name: "Basics V2",
    library_identifier: "basics-v2",
    name,
    key,
    component_type: componentType,
    schema: {
      template_type: templateType,
      description: `${name} product experience.`,
      slottable,
      properties: [
        { key: "title", type: "string" },
        { key: "body", type: "string" },
        { key: "dismissible", type: "boolean" },
        { key: "primaryButton", type: "action" },
      ],
    },
    exit_nodes: exitNodes,
    css_variables: {},
    current_version: 1,
    instance_count: 0,
    outdated_instances: outdatedInstances,
  };
}
