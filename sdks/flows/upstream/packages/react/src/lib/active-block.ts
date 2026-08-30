import {
  createComponentProps,
  type SetStateMemory,
  type ActiveBlock,
  type Block,
  createActiveBlockProxy,
  createTourComponentProps,
  type UserProperties,
  createSurveyComponentProps,
} from "@superboard/flows-shared";
import { type RemoveBlock, type UpdateBlock, type RunningTour } from "../flows-context";
import { postSurvey, sendActivate, sendEvent } from "./api";

const getSetStateMemory = (updateBlock: UpdateBlock, blockStateId?: string): SetStateMemory => {
  return async ({ blockId, key, value }) => {
    updateBlock(blockId, (b) => ({
      ...b,
      propertyMeta: b.propertyMeta?.map((sp) => {
        if (sp.type === "state-memory" && sp.key === key) return { ...sp, value };
        return sp;
      }),
    }));

    await sendEvent({
      name: "set-state-memory",
      blockId,
      blockStateId,
      propertyKey: key,
      properties: { value },
    });
  };
};

export const isBlock = (item: Block | RunningTour): item is Block => "type" in item;

export const itemToActiveBlock = (
  item: Block | RunningTour,
  {
    removeBlock,
    updateBlock,
    userProperties,
    legacyBranding,
  }: {
    removeBlock: RemoveBlock;
    updateBlock: UpdateBlock;
    userProperties: UserProperties;
    legacyBranding: boolean;
  },
): ActiveBlock | [] => {
  if (isBlock(item) && item.type === "component")
    return blockToActiveBlock({
      block: item,
      removeBlock,
      updateBlock,
      userProperties,
      legacyBranding,
    });
  if (isBlock(item) && item.type === "survey")
    return surveyBlockToActiveBlock({
      block: item,
      removeBlock,
      updateBlock,
      userProperties,
      legacyBranding,
    });
  if (!isBlock(item)) return tourBlockToActiveBlock({ tour: item, userProperties, legacyBranding });
  return [];
};

export const blockToActiveBlock = ({
  block,
  removeBlock,
  updateBlock,
  userProperties,
  legacyBranding,
}: {
  block: Block;
  removeBlock: RemoveBlock;
  updateBlock: UpdateBlock;
  userProperties: UserProperties;
  legacyBranding: boolean;
}): ActiveBlock | [] => {
  if (block.type !== "component") return [];
  if (!block.componentType) return [];

  const setStateMemory = getSetStateMemory(updateBlock, block.blockStateId);

  const props = createComponentProps({
    block,
    userProperties,
    removeBlock,
    exitNodeCb: ({ key, blockId }) => sendEvent({ name: "transition", blockId, blockStateId: block.blockStateId, propertyKey: key }),
    setStateMemory,
    legacyBranding,
  });

  const activeBlock: ActiveBlock = {
    id: block.id,
    blockStateId: block.blockStateId,
    type: block.type,
    component: block.componentType,
    props,
  };

  return createActiveBlockProxy(activeBlock, sendActivate);
};

export const tourBlockToActiveBlock = ({
  tour,
  userProperties,
  legacyBranding,
}: {
  tour: RunningTour;
  userProperties: UserProperties;
  legacyBranding: boolean;
}): ActiveBlock | [] => {
  const activeStep = tour.activeStep;
  if (!activeStep?.componentType) return [];

  const props = createTourComponentProps({
    tourSteps: tour.block.tourBlocks ?? [],
    tourStep: activeStep,
    currentIndex: tour.currentBlockIndex,
    legacyBranding,
    userProperties,
    handleCancel: tour.cancel,
    handleContinue: tour.continue,
    handlePrevious: tour.previous,
  });

  const activeBlock: ActiveBlock = {
    id: activeStep.id,
    blockStateId: tour.block.blockStateId,
    tourBlockId: tour.block.id,
    type: "tour-component",
    component: activeStep.componentType,
    props,
  };

  return createActiveBlockProxy(activeBlock, sendActivate);
};

export const surveyBlockToActiveBlock = ({
  block,
  userProperties,
  legacyBranding,
  removeBlock,
  updateBlock,
}: {
  block: Block;
  userProperties: UserProperties;
  legacyBranding: boolean;
  updateBlock: UpdateBlock;
  removeBlock: RemoveBlock;
}): ActiveBlock | [] => {
  if (block.type !== "survey") return [];
  if (!block.componentType) return [];

  const setStateMemory = getSetStateMemory(updateBlock, block.blockStateId);

  const props = createSurveyComponentProps({
    block,
    userProperties,
    legacyBranding,
    removeBlock,
    exitNodeCb: ({ key, blockId }) => sendEvent({ name: "transition", blockId, blockStateId: block.blockStateId, propertyKey: key }),
    setStateMemory,
    submitSurvey: postSurvey,
  });

  if (!props) return [];

  const activeBlock: ActiveBlock = {
    id: block.id,
    blockStateId: block.blockStateId,
    type: "survey",
    component: block.componentType,
    props,
  };

  return createActiveBlockProxy(activeBlock, sendActivate);
};
