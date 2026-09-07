import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "../../../../../../../../../supbrd-front-ui/src/shared/lib/queryKeys.js";
import type {
	Campaign,
	GetCampaignsParams,
	DateRangeQuery,
} from "../../../../../../../../../supbrd-front-ui/src/shared/types/index.js";
import {
	getCampaignsAPICall,
	getCampaignMetricsAPICall,
} from "../../api/campaigns/campaignsService.js";

interface CampaignsListResult {
	data: Campaign[];
	totalPages: number;
	totalEntries: number;
}

export function useCampaignsListQuery(
	projectId: string | undefined,
	params: GetCampaignsParams | null,
) {
	return useQuery<CampaignsListResult>({
		queryKey: queryKeys.projects.campaigns(projectId!, params ?? undefined),
		queryFn: async () => {
			const response = await getCampaignsAPICall(projectId!, params!);
			return {
				data: response.data.data,
				totalPages: response.data.total_pages,
				totalEntries: response.data.total_entries,
			};
		},
		enabled: !!projectId && !!params,
	});
}

export function useCampaignMetricsQuery(
	projectId: string | undefined,
	params: DateRangeQuery | null,
) {
	return useQuery({
		queryKey: queryKeys.projects.campaignMetrics(projectId!, params ?? undefined),
		queryFn: async () => {
			const response = await getCampaignMetricsAPICall(projectId!, params!);
			return response.data.metrics;
		},
		enabled: !!projectId && !!params,
	});
}
