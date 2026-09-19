import {
  getApi,
  log,
  type WorkflowsResponse,
  type EventRequest,
  enqueueEvent,
} from "@superboard/flows-shared";
import { globalConfig } from "./store";
import { packageAndVersion } from "./constants";
import type { ApiSurveyAnswer } from "@superboard/flows-shared";

type SendEventProps = Omit<EventRequest, "userId" | "environment" | "projectId">;

export const sendEvent = async (props: SendEventProps, idempotencyKey?: string): Promise<void> => {
  const { apiUrl, environment, projectId, userId, customFetch } = globalConfig;
  if (!apiUrl || !environment || !projectId || !userId) return;

  return enqueueEvent({
    apiContext: { apiUrl, version: packageAndVersion },
    customFetch,
    idempotencyKey,
    event: {
      ...props,
      environment,
      projectId,
      userId,
    },
  });
};

export const postSurvey = async (
  props: Omit<ApiSurveyAnswer, "userId" | "environment" | "projectId" | "url">,
) => {
  const { apiUrl, environment, projectId, userId, customFetch } = globalConfig;
  if (!apiUrl || !environment || !projectId || !userId) return;

  await getApi({ apiUrl, version: packageAndVersion, customFetch }).postSurvey({
    ...props,
    environment,
    projectId,
    userId,
    url: window.location.href,
  }, `survey:${props.blockStateId}`);
};

const activatedBlockStates = new Set<string>();
export const sendActivate = async (blockId: string, blockStateId?: string): Promise<void> => {
  const activationState = blockStateId ? `${blockStateId}:${blockId}` : blockId;
  if (activatedBlockStates.has(activationState)) return;

  activatedBlockStates.add(activationState);
  try {
    await sendEvent(
      { name: "block-activated", blockId, blockStateId },
      blockStateId ? `activation:${activationState}` : undefined,
    );
  } catch (error) {
    activatedBlockStates.delete(activationState);
    throw error;
  }
};

/**
 * Returns all available workflows for the current user. Before calling this method, the `<FlowsProvider>` component must be rendered.
 * @returns A promise resolving to a {@link WorkflowsResponse} object containing an array of enabled workflows.
 */
export const fetchWorkflows = async (): Promise<WorkflowsResponse> => {
  const { apiUrl, environment, projectId, userId, customFetch } = globalConfig;
  if (!apiUrl || !environment || !projectId || !userId) {
    log.error("fetchWorkflows() called before rendering <FlowsProvider>");
    return { workflows: [] };
  }

  return getApi({ apiUrl, version: packageAndVersion, customFetch }).getWorkflows({
    environment,
    projectId,
    userId,
  });
};
