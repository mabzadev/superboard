import {
  type Block,
  type ActiveBlock,
  createComponentProps,
  type SetStateMemory,
  createActiveBlockProxy,
  createTourComponentProps,
  type UserProperties,
  createSurveyComponentProps,
} from "@superboard/flows-shared";
import type { RunningTour } from "../store";
import { blocks, removeBlock, updateBlock } from "../store";
import { nextTourStep, previousTourStep, cancelTour } from "./tour";
import { postSurvey, sendActivate, sendEvent } from "./api";

const setStateMemory: SetStateMemory = async ({ blockId, key, value }) => {
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
    blockStateId: blocks.peek()?.find((block) => block.id === blockId)?.blockStateId,
    propertyKey: key,
    properties: { value },
  });
};

type TourItem = RunningTour & { block: Block };
export const isBlock = (item: Block | TourItem): item is Block => "type" in item;
export const itemToActiveBlock = ({
  legacyBranding,
  item,
  userProperties,
}: {
  item: Block | TourItem;
  userProperties: UserProperties;
  legacyBranding: boolean;
}): ActiveBlock | [] => {
  if (isBlock(item) && item.type === "component")
    return blockToActiveBlock({
      block: item,
      userProperties,
      legacyBranding,
    });
  if (isBlock(item) && item.type === "survey")
    return surveyBlockToActiveBlock({
      block: item,
      userProperties,
      legacyBranding,
    });
  if (!isBlock(item))
    return tourToActiveBlock({
      block: item.block,
      currentIndex: item.currentBlockIndex,
      userProperties,
      legacyBranding,
    });

  return [];
};

export const blockToActiveBlock = ({
  block,
  userProperties,
  legacyBranding,
}: {
  block: Block;
  userProperties: UserProperties;
  legacyBranding: boolean;
}): ActiveBlock | [] => {
  if (!block.componentType) return [];

  const props = createComponentProps({
    block,
    userProperties,
    legacyBranding,
    removeBlock,
    exitNodeCb: ({ key, blockId }) => sendEvent({ name: "transition", blockId, blockStateId: block.blockStateId, propertyKey: key }),
    setStateMemory,
  });

  const activeBlock: ActiveBlock = {
    id: block.id,
    blockStateId: block.blockStateId,
    type: "component",
    component: block.componentType,
    props,
  };

  return createActiveBlockProxy(activeBlock, sendActivate);
};

export const tourToActiveBlock = ({
  block,
  currentIndex,
  userProperties,
  legacyBranding,
}: {
  block: Block;
  currentIndex: number;
  userProperties: UserProperties;
  legacyBranding: boolean;
}): ActiveBlock | [] => {
  const tourBlocks = block.tourBlocks;
  if (!tourBlocks?.length) return [];
  const activeStep = tourBlocks.at(currentIndex);
  if (!activeStep?.componentType) return [];

  const props = createTourComponentProps({
    tourSteps: tourBlocks,
    tourStep: activeStep,
    currentIndex,
    userProperties,
    legacyBranding,
    handleContinue: () => {
      nextTourStep(block, currentIndex);
    },
    handlePrevious: () => {
      previousTourStep(block, currentIndex);
    },
    handleCancel: () => {
      cancelTour(block);
    },
  });

  const activeBlock: ActiveBlock = {
    id: activeStep.id,
    blockStateId: block.blockStateId,
    tourBlockId: block.id,
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
}: {
  block: Block;
  userProperties: UserProperties;
  legacyBranding: boolean;
}): ActiveBlock | [] => {
  if (block.type !== "survey") return [];
  if (!block.componentType) return [];

  const props = createSurveyComponentProps({
    block,
    userProperties,
    legacyBranding,
    setStateMemory,
    removeBlock,
    exitNodeCb: ({ key, blockId }) => sendEvent({ name: "transition", blockId, blockStateId: block.blockStateId, propertyKey: key }),
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
