import type {
  FlowBlockType as ContractFlowBlockType,
  FlowEditorBlock,
  FlowGraph as ContractFlowGraph,
  FlowPath as ContractFlowPath,
} from "@superboard/contracts/flows";
import { DELETE, GET, PATCH, POST, PUT } from "@/lib/api";
import { config } from "@/lib/config";

export type FlowOrigin = "flows" | "paywalls" | "onboardings";
export type FlowStatus = "draft" | "active" | "paused" | "archived";
export type FlowFrequency = "once" | "every-time";
export type FlowBlockType = ContractFlowBlockType;
export type FlowBlock = FlowEditorBlock;
export type FlowPath = ContractFlowPath;
export type FlowGraph = ContractFlowGraph;

export type FlowProject = {
  project_ref: string;
  sdk_identifier: string;
  created_at: string;
};

export type FlowEnvironment = {
  id: string;
  name: string;
  key: string;
  kind: "production" | "test" | "development";
  active: boolean | number;
  allow_draft: boolean | number;
  sdk_key?: string;
  created_at?: string;
};

export type FlowLanguageGroup = {
  id: string;
  name: string;
  default_locale: string;
  locales: string[];
  fallbacks: Record<string, string>;
};

export type FlowWorkflow = {
  id: string;
  identifier: string;
  name: string;
  description?: string | null;
  frequency: FlowFrequency;
  status: FlowStatus;
  origin: FlowOrigin;
  latest_version?: number | null;
  active_environments?: number;
  draft_revision: number;
  created_at?: string;
  updated_at?: string;
};

export type FlowVersion = {
  id: string;
  version: number;
  changelog?: string | null;
  migration_strategy: "finish-current" | "restart-current" | "restart-all";
  published_at: string;
  checksum_sha256?: string;
};

export type FlowRelease = {
  environment_id: string;
  environment_name: string;
  environment_key: string;
  workflow_version_id?: string | null;
  version?: number | null;
  use_draft: boolean | number;
  active: boolean | number;
  activated_at?: string | null;
  migration_execution_id?: string | null;
  runtime_version_id?: string | null;
};

export type FlowWorkflowDetails = FlowWorkflow & {
  draft: {
    revision: number;
    graph: FlowGraph;
    validation: { valid: boolean; issues: string[] };
    updated_at: string;
  } | null;
  versions: FlowVersion[];
  releases: FlowRelease[];
  translations: Array<{
    block_key: string;
    property_key: string;
    locale: string;
    value: unknown;
  }>;
};

export type FlowTranslation = FlowWorkflowDetails["translations"][number];

export type FlowOverview = {
  counters: {
    workflows: number;
    active_workflows: number;
    users: number;
    events: number;
    survey_responses: number;
    dead_letters: number;
  };
  recent_activity: Array<{
    event_id: string;
    event_name: string;
    workflow_id?: string | null;
    block_key?: string | null;
    environment_id: string;
    occurred_at: string;
    legacy_event_type?: string | null;
  }>;
};

export type FlowLaunchpadWorkflow = {
  group_id: string;
  workflow_id: string;
  priority: number;
  name: string;
  identifier: string;
  status: FlowStatus;
};
export type FlowLaunchpadGroup = {
  id: string;
  name: string;
  environment_id: string;
  environment_name: string;
  environment_key: string;
  position: number;
  concurrency_limit: number | null;
  paused: boolean | number;
  workflows: FlowLaunchpadWorkflow[];
};

export type FlowUser = {
  environment_id: string;
  user_id_hash: string;
  locale?: string | null;
  country?: string | null;
  platform?: string | null;
  first_seen_at: string;
  last_seen_at: string;
  workflows_in_progress: number;
};

export type FlowUserDetails = {
  profiles: FlowUser[];
  workflow_states: Array<{
    workflow_id: string;
    workflow_name: string;
    workflow_identifier: string;
    state: "not-started" | "in-progress" | "completed" | "stopped";
    active_block_ids: string[];
    updated_at: string;
  }>;
  events: Array<{
    event_id: string;
    event_name: string;
    block_key?: string | null;
    occurred_at: string;
    properties: Record<string, unknown>;
  }>;
};

export type FlowComponentLibrary = {
  id: string;
  name: string;
  identifier: string;
  enabled: boolean | number;
  source: string;
};
export type FlowComponentDefinition = {
  id: string;
  library_id: string;
  library_name?: string;
  library_identifier?: string;
  name: string;
  key: string;
  component_type: string;
  schema: Record<string, unknown>;
  exit_nodes: string[];
  css_variables: Record<string, string>;
  current_version?: number | null;
  instance_count?: number;
  outdated_instances?: number;
};

export type FlowWorkflowAnalytics = {
  from: string;
  to: string;
  environment_id?: string | null;
  totals: Array<{ event_name: string; count: number; users: number }>;
  timeline: Array<{ day: string; event_name: string; count: number }>;
  blocks: Array<{
    block_id: string;
    block_key: string;
    event_name: string;
    count: number;
    users: number;
  }>;
};

export type FlowSurveyAnalytics = {
  survey_id: string;
  from: string;
  to: string;
  environment_id?: string | null;
  summary: { shown: number; responses: number; completion: number };
  numeric: {
    count: number;
    average: number | null;
    median: number | null;
    standard_deviation: number | null;
  };
  distributions: Record<string, number>;
  links: { clicks: number; conversion?: number };
  responses: Array<Record<string, unknown>>;
};

type DataEnvelope<T> = T | { data: T };
type Response<T> = { data: DataEnvelope<T> };

const unwrap = <T>(response: Response<T>): T => {
  const value = response.data;
  return value && typeof value === "object" && "data" in value
    ? (value as { data: T }).data
    : (value as T);
};

const projectPath = (projectRef: string, resource = "") =>
  `${config.apiPath}/flows/projects/${encodeURIComponent(projectRef)}${resource}`;

export const flowsApi = {
  getProject: async (projectRef: string) =>
    unwrap<FlowProject>(await GET(projectPath(projectRef, "/project"))),
  overview: async (projectRef: string) =>
    unwrap<FlowOverview>(await GET(projectPath(projectRef, "/overview"))),
  listWorkflows: async (
    projectRef: string,
    filters: { search?: string; status?: string; origin?: string } = {}
  ) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter((entry): entry is [string, string] =>
        Boolean(entry[1])
      )
    ).toString();
    return unwrap<{ items: FlowWorkflow[] }>(
      await GET(
        projectPath(projectRef, `/workflows${query ? `?${query}` : ""}`)
      )
    ).items;
  },
  createWorkflow: async (
    projectRef: string,
    body: {
      name: string;
      identifier: string;
      description?: string;
      frequency: FlowFrequency;
      origin?: FlowOrigin;
    }
  ) =>
    unwrap<FlowWorkflowDetails>(
      await POST(projectPath(projectRef, "/workflows"), body)
    ),
  getWorkflow: async (projectRef: string, workflowId: string) =>
    unwrap<FlowWorkflowDetails>(
      await GET(
        projectPath(projectRef, `/workflows/${encodeURIComponent(workflowId)}`)
      )
    ),
  updateWorkflow: async (
    projectRef: string,
    workflowId: string,
    body: Partial<
      Pick<FlowWorkflow, "name" | "description" | "frequency" | "status">
    >
  ) =>
    unwrap<FlowWorkflow>(
      await PUT(
        projectPath(projectRef, `/workflows/${encodeURIComponent(workflowId)}`),
        body
      )
    ),
  saveDraft: async (
    projectRef: string,
    workflowId: string,
    graph: FlowGraph,
    revision: number
  ) =>
    unwrap<{
      workflow_id: string;
      revision: number;
      graph: FlowGraph;
      validation: { valid: boolean; issues: string[] };
      updated_at: string;
    }>(
      await PUT(
        projectPath(
          projectRef,
          `/workflows/${encodeURIComponent(workflowId)}/draft`
        ),
        { graph, revision }
      )
    ),
  publishWorkflow: async (
    projectRef: string,
    workflowId: string,
    body: { migration_strategy: string; changelog?: string }
  ) =>
    unwrap<FlowVersion>(
      await POST(
        projectPath(
          projectRef,
          `/workflows/${encodeURIComponent(workflowId)}/publish`
        ),
        body
      )
    ),
  saveTranslations: async (
    projectRef: string,
    workflowId: string,
    items: Array<{
      block_key: string;
      property_key: string;
      locale: string;
      value: unknown;
    }>
  ) =>
    unwrap<{ workflow_id: string; count: number; updated_at: string }>(
      await PUT(
        projectPath(
          projectRef,
          `/workflows/${encodeURIComponent(workflowId)}/translations`
        ),
        { items }
      )
    ),
  getVersion: async (
    projectRef: string,
    workflowId: string,
    versionId: string
  ) =>
    unwrap<FlowVersion & { graph: FlowGraph }>(
      await GET(
        projectPath(
          projectRef,
          `/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(versionId)}`
        )
      )
    ),
  activateRelease: async (
    projectRef: string,
    workflowId: string,
    body: {
      environment_id: string;
      version_id?: string;
      use_draft?: boolean;
      active?: true;
    }
  ) =>
    unwrap<FlowRelease>(
      await POST(
        projectPath(
          projectRef,
          `/workflows/${encodeURIComponent(workflowId)}/releases`
        ),
        body
      )
    ),
  duplicateWorkflow: async (
    projectRef: string,
    workflowId: string,
    body: { name?: string; identifier: string }
  ) =>
    unwrap<FlowWorkflow>(
      await POST(
        projectPath(
          projectRef,
          `/workflows/${encodeURIComponent(workflowId)}/duplicate`
        ),
        body
      )
    ),
  workflowAnalytics: async (projectRef: string, workflowId: string) =>
    unwrap<FlowWorkflowAnalytics>(
      await GET(
        projectPath(
          projectRef,
          `/workflows/${encodeURIComponent(workflowId)}/analytics`
        )
      )
    ),
  surveyAnalytics: async (projectRef: string, surveyId: string) =>
    unwrap<FlowSurveyAnalytics>(
      await GET(
        projectPath(
          projectRef,
          `/surveys/${encodeURIComponent(surveyId)}/analytics`
        )
      )
    ),
  exportSurveyCsv: async (projectRef: string, surveyId: string) =>
    unwrap<{
      id: string;
      status: "completed";
      r2_key: string;
      row_count: number;
    }>(
      await POST(
        projectPath(
          projectRef,
          `/surveys/${encodeURIComponent(surveyId)}/export`
        )
      )
    ),
  getLaunchpad: async (projectRef: string) =>
    unwrap<{ groups: FlowLaunchpadGroup[] }>(
      await GET(projectPath(projectRef, "/launchpad"))
    ).groups,
  createLaunchpadGroup: async (
    projectRef: string,
    body: {
      name: string;
      environment_id: string;
      position: number;
      concurrency_limit: number | null;
      paused?: boolean;
    }
  ) =>
    unwrap<FlowLaunchpadGroup>(
      await POST(projectPath(projectRef, "/launchpad/groups"), body)
    ),
  updateLaunchpadGroup: async (
    projectRef: string,
    groupId: string,
    body: Partial<
      Pick<
        FlowLaunchpadGroup,
        "name" | "position" | "concurrency_limit" | "paused"
      >
    >
  ) =>
    unwrap<FlowLaunchpadGroup>(
      await PATCH(
        projectPath(
          projectRef,
          `/launchpad/groups/${encodeURIComponent(groupId)}`
        ),
        body
      )
    ),
  setLaunchpadWorkflows: async (
    projectRef: string,
    groupId: string,
    workflows: Array<{ workflow_id: string; priority: number }>
  ) =>
    unwrap<{ id: string }>(
      await PUT(
        projectPath(
          projectRef,
          `/launchpad/groups/${encodeURIComponent(groupId)}/workflows`
        ),
        { workflows }
      )
    ),
  deleteLaunchpadGroup: async (projectRef: string, groupId: string) =>
    unwrap<{ deleted: boolean }>(
      await DELETE(
        projectPath(
          projectRef,
          `/launchpad/groups/${encodeURIComponent(groupId)}`
        )
      )
    ),
  listUsers: async (projectRef: string, environmentId?: string) =>
    unwrap<{ items: FlowUser[] }>(
      await GET(
        projectPath(
          projectRef,
          `/users${environmentId ? `?environment_id=${encodeURIComponent(environmentId)}` : ""}`
        )
      )
    ).items,
  getUser: async (projectRef: string, userHash: string) =>
    unwrap<FlowUserDetails>(
      await GET(
        projectPath(projectRef, `/users/${encodeURIComponent(userHash)}`)
      )
    ),
  resetUser: async (
    projectRef: string,
    userHash: string,
    workflowId?: string
  ) =>
    unwrap<{ states_removed: number }>(
      await POST(
        projectPath(projectRef, `/users/${encodeURIComponent(userHash)}/reset`),
        workflowId ? { workflow_id: workflowId } : {}
      )
    ),
  listComponents: async (projectRef: string) => {
    const result = unwrap<{
      libraries: FlowComponentLibrary[];
      items: FlowComponentDefinition[];
    }>(await GET(projectPath(projectRef, "/components")));
    return { libraries: result.libraries, components: result.items };
  },
  createComponentLibrary: async (
    projectRef: string,
    body: { name: string; identifier: string }
  ) =>
    unwrap<FlowComponentLibrary>(
      await POST(projectPath(projectRef, "/component-libraries"), body)
    ),
  updateComponentLibrary: async (
    projectRef: string,
    libraryId: string,
    body: { name: string; enabled: boolean }
  ) =>
    unwrap<FlowComponentLibrary>(
      await PATCH(
        projectPath(
          projectRef,
          `/component-libraries/${encodeURIComponent(libraryId)}`
        ),
        body
      )
    ),
  createComponent: async (
    projectRef: string,
    body: {
      library_id: string;
      name: string;
      key: string;
      component_type: string;
      schema: Record<string, unknown>;
      exit_nodes: string[];
      css_variables: Record<string, string>;
    }
  ) =>
    unwrap<FlowComponentDefinition>(
      await POST(projectPath(projectRef, "/components"), body)
    ),
  updateComponent: async (
    projectRef: string,
    componentId: string,
    body: {
      name?: string;
      schema?: Record<string, unknown>;
      exit_nodes?: string[];
      css_variables?: Record<string, string>;
    }
  ) =>
    unwrap<FlowComponentDefinition>(
      await PATCH(
        projectPath(
          projectRef,
          `/components/${encodeURIComponent(componentId)}`
        ),
        body
      )
    ),
  synchronizeComponent: async (projectRef: string, componentId: string) =>
    unwrap<{
      id: string;
      component_key: string;
      version: number;
      synchronized: boolean;
    }>(
      await POST(
        projectPath(
          projectRef,
          `/components/${encodeURIComponent(componentId)}/sync`
        )
      )
    ),
  listEnvironments: async (projectRef: string) =>
    unwrap<{ items: FlowEnvironment[] }>(
      await GET(projectPath(projectRef, "/environments"))
    ).items,
  createEnvironment: async (
    projectRef: string,
    body: { name: string; key: string; kind: string; allow_draft: boolean }
  ) =>
    unwrap<FlowEnvironment>(
      await POST(projectPath(projectRef, "/environments"), body)
    ),
  rotateEnvironmentKey: async (projectRef: string, environmentId: string) =>
    unwrap<{ id: string; sdk_key: string }>(
      await POST(
        projectPath(
          projectRef,
          `/environments/${encodeURIComponent(environmentId)}/rotate-key`
        )
      )
    ),
  listLocalization: async (projectRef: string) =>
    unwrap<{ items: FlowLanguageGroup[] }>(
      await GET(projectPath(projectRef, "/localization"))
    ).items,
  saveLocalization: async (
    projectRef: string,
    body: {
      id?: string;
      name: string;
      default_locale: string;
      locales: string[];
      fallbacks: Record<string, string>;
    }
  ) =>
    unwrap<FlowLanguageGroup>(
      await PUT(projectPath(projectRef, "/localization"), body)
    ),
};
