import type { ApiSurveyAnswer, WorkflowsResponse } from "@superboard/flows-shared";
import { enqueueEvent, type EventRequest, getApi, log } from "@superboard/flows-shared";
import { config } from "../store";
import { packageAndVersion } from "./constants";

type SendEventProps = Pick<
  EventRequest,
  "name" | "blockId" | "blockStateId" | "blockKey" | "propertyKey" | "properties" | "workflowId"
>;

export const sendEvent = async (props: SendEventProps, idempotencyKey?: string): Promise<void> => {
  const configuration = config.value;
  if (!configuration) return;
  const { environment, projectId, userId, apiUrl, customFetch } = configuration;

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
  const configuration = config.value;
  if (!configuration) return;
  const { apiUrl, environment, projectId, userId, customFetch } = configuration;
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
 * Returns all available workflows for the current user. Before calling this method, the `init()` method must be called first.
 * @returns A promise resolving to a {@link WorkflowsResponse} object containing an array of enabled workflows.
 */
export const fetchWorkflows = async (): Promise<WorkflowsResponse> => {
  const configuration = config.value;
  if (!configuration) {
    log.error("fetchWorkflows() called before init() method was called");
    return { workflows: [] };
  }

  const { environment, projectId, userId, apiUrl, customFetch } = configuration;
  return getApi({ apiUrl, version: packageAndVersion, customFetch }).getWorkflows({
    environment,
    projectId,
    userId,
  });
};
