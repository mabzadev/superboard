import { type Block, type TourStep } from "@superboard/flows-shared";

export const getSlot = (block?: Block | TourStep): string | undefined => block?.slotId;
