import type { Block, TourStep, TourTriggerExpression } from "@superboard/flows-shared";
import type { Page } from "@playwright/test";
import { randomUUID } from "crypto";

export const mockBlocksEndpoint = async (
  page: Page,
  blocks: Block[],
  legacy_branding: boolean = false,
): Promise<void> => {
  await page.unroute("**/v2/sdk/blocks");
  await page.route("**/v2/sdk/blocks", async (route) => {
    await route.fulfill({ json: { blocks, meta: { legacy_branding } } });
  });
};

export const getTour = ({
  tourBlocks,
  tour_trigger,
}: {
  tourBlocks: TourStep[];
  tour_trigger?: TourTriggerExpression[];
}): Block => ({
  id: randomUUID(),
  workflowId: randomUUID(),
  type: "tour",
  data: {},
  exitNodes: ["complete", "cancel"],
  slottable: false,
  propertyMeta: [],
  tourBlocks,
  tour_trigger: tour_trigger ? { $and: tour_trigger } : undefined,
});
