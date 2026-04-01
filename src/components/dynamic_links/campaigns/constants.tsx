import type { Campaign } from "@/types";

export type CampaignDataType = {
  campaign: Campaign;
  metrics: Record<string, number>;
  links: [];
};
