import type { CustomFetch } from "./types";
import { type Block } from "./types";
import type { ApiSurveyAnswer } from "./types/api-survey";

export const DEFAULT_API_URL = "/api/v1/flows";

export const getDefaultApiUrl = (): string => DEFAULT_API_URL;

export const joinApiUrl = (baseUrl: string, path: string): string => {
  const normalizedBase = baseUrl.replace(/\/+$/u, "");
  const normalizedPath = path.replace(/^\/+/u, "");
  return `${normalizedBase}/${normalizedPath}`;
};

export const getWebSocketUrl = (
  baseUrl: string,
  path: string,
  params: Record<string, string>,
): string => {
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL(joinApiUrl(baseUrl, path), origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = new URLSearchParams(params).toString();
  return url.toString();
};

export const FLOW_SDK_KEY_HEADER = "x-superboard-flows-sdk-key";

/** Add the environment credential at the shared transport boundary. */
export const withSdkKey = (
  customFetch: CustomFetch | undefined,
  sdkKey: string | undefined,
): CustomFetch | undefined => {
  const credential = sdkKey?.trim();
  if (!credential) return customFetch;
  const fetchFn = customFetch ?? globalThis.fetch.bind(globalThis);
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has(FLOW_SDK_KEY_HEADER)) headers.set(FLOW_SDK_KEY_HEADER, credential);
    return fetchFn(input, { ...init, headers });
  };
};

const getFetch =
  (ctx: { customFetch?: CustomFetch; baseUrl: string }) =>
  <T>(
    url: string,
    { body, method, version, idempotencyKey }: {
      method?: string;
      body?: unknown;
      version: string;
      idempotencyKey?: string;
    },
  ): Promise<T> => {
    const fetchFn = ctx.customFetch ?? fetch;

    return fetchFn(joinApiUrl(ctx.baseUrl, url), {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-flows-version": version,
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (res) => {
      const text = await res.text();
      const resBody = (text ? JSON.parse(text) : undefined) as T;
      if (!res.ok) {
        const errorBody = resBody as undefined | { message?: string };
        throw new Error(errorBody?.message ?? res.statusText);
      }
      return resBody;
    });
  };

// POST /v2/sdk/blocks

interface GetBlocksRequest {
  userId: string;
  environment: string;
  projectId: string;
  userProperties?: Record<string, unknown>;
  language?: string;
}

interface BlocksResponse {
  blocks: Block[];
}

// POST /v2/sdk/workflows

export interface WorkflowsRequest {
  userId: string;
  environment: string;
  projectId: string;
}

export type WorkflowStatus = "enabled" | "launchpad-enabled";
export type WorkflowFrequency = "once" | "every-time";

export type WorkflowUserState = "not-started" | "in-progress" | "completed" | "stopped";

export interface Workflow {
  /**
   * UUID of the workflow. You can find it in the Flows app in the workflow detail by opening the three dot menu.
   */
  id: string;
  /**
   * How the workflow is currently enabled in Flows. Can be either:
   * - `enabled`: The workflow is published and active.
   * - `launchpad-enabled`: The workflow is published, active, and inside an active launchpad group.
   */
  workflow_status: WorkflowStatus;
  /**
   * How often the workflow can be shown to the user. Can be either:
   * - `once`: The workflow can only be entered once.
   * - `every-time`: The workflow can be entered every time.
   */
  frequency: WorkflowFrequency;
  /**
   * The user's current state in the workflow. Can be either:
   * - `not-started`: The user has not entered the workflow.
   * - `in-progress`: The user is currently in the workflow.
   * - `completed`: The user has completed the workflow.
   * - `stopped`: The user has been stopped the workflow (e.g., by a workflow migration).
   */
  user_state: WorkflowUserState;
  /**
   * ISO string of when the user entered the workflow.
   */
  entered_at?: string;
  /**
   * ISO string of when the user exited the workflow.
   */
  exited_at?: string;
}

export interface WorkflowsResponse {
  workflows: Workflow[];
}

// POST /v2/sdk/events

export interface EventRequest {
  userId: string;
  environment: string;
  projectId: string;
  name:
    | "transition"
    | "tour-update"
    | "reset-progress"
    | "workflow-start"
    | "set-state-memory"
    | "block-activated";
  workflowId?: string;
  blockId?: string;
  blockStateId?: string;
  blockKey?: string;
  propertyKey?: string;
  properties?: Record<string, unknown>;
}

export type ApiContext = {
  apiUrl: string;
  version: string;
  customFetch?: CustomFetch;
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- ignore
export const getApi = ({ apiUrl, version, customFetch }: ApiContext) => {
  const f = getFetch({ customFetch, baseUrl: apiUrl });
  return {
    getBlocks: (body: GetBlocksRequest) =>
      f<BlocksResponse>("/v2/sdk/blocks", { method: "POST", body, version }),
    getWorkflows: (body: WorkflowsRequest) =>
      f<WorkflowsResponse>("/v2/sdk/workflows", { method: "POST", body, version }),
    sendEvent: (body: EventRequest, idempotencyKey?: string) =>
      f("/v2/sdk/events", { method: "POST", body, version, idempotencyKey }),
    postSurvey: (body: ApiSurveyAnswer, idempotencyKey?: string) =>
      f("/v2/sdk/survey", { method: "POST", body, version, idempotencyKey }),
  };
};
