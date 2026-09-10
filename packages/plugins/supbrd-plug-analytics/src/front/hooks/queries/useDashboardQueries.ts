import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "../../../../../../supbrd-front-ui/src/shared/lib/queryKeys.js";
import type {
	DashboardLink,
	MetricsOverview,
	LinksViews,
	DateRangeQuery,
} from "../../../../../../supbrd-front-ui/src/shared/types/index.js";
import {
	getTopLinksAPICall,
	getLinksViewsAPICall,
	getMetricsOverviewAPICall,
} from "../../api/dashboard/dashboardService.js";

export function useTopLinksQuery(projectId: string | undefined, params: DateRangeQuery | null) {
	return useQuery<DashboardLink[]>({
		queryKey: queryKeys.projects.topLinks(projectId!, params ?? undefined),
		queryFn: async () => {
			const response = await getTopLinksAPICall(projectId!, params!);
			return response.data.links;
		},
		enabled: !!projectId && !!params,
	});
}

export function useLinksViewsQuery(projectId: string | undefined, params: DateRangeQuery | null) {
	return useQuery<LinksViews>({
		queryKey: queryKeys.projects.linksViews(projectId!, params ?? undefined),
		queryFn: async () => {
			const response = await getLinksViewsAPICall(projectId!, params!);
			return response.data.metrics;
		},
		enabled: !!projectId && !!params,
	});
}

export function useMetricsOverviewQuery(
	projectId: string | undefined,
	params: DateRangeQuery | null,
) {
	return useQuery<MetricsOverview>({
		queryKey: queryKeys.projects.metricsOverview(projectId!, params ?? undefined),
		queryFn: async () => {
			const response = await getMetricsOverviewAPICall(projectId!, params!);
			return response.data.metrics;
		},
		enabled: !!projectId && !!params,
	});
}
