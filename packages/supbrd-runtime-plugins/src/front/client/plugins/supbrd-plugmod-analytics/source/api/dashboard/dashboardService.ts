import type { AxiosResponse } from "axios";

import { POST } from "../../../../../../../../../supbrd-front-ui/src/shared/lib/api.js";
import { config } from "../../../../../../../../../supbrd-front-ui/src/shared/lib/config.js";
import type {
	DashboardLink,
	MetricsOverview,
	LinksViews,
	DateRangeQuery,
} from "../../../../../../../../../supbrd-front-ui/src/shared/types/index.js";

// --- Response types ---

interface GetTopLinksResponse {
	links: DashboardLink[];
}

interface GetLinksViewsResponse {
	metrics: LinksViews;
}

interface GetMetricsOverviewResponse {
	metrics: MetricsOverview;
}

// --- API calls ---

export const getTopLinksAPICall = async (
	projectId: string,
	formData: DateRangeQuery,
): Promise<AxiosResponse<GetTopLinksResponse>> => {
	return POST(config.apiPath + `/projects/${projectId}/dashboard/top_links`, formData);
};

export const getLinksViewsAPICall = async (
	projectId: string,
	formData: DateRangeQuery,
): Promise<AxiosResponse<GetLinksViewsResponse>> => {
	return POST(config.apiPath + `/projects/${projectId}/dashboard/links_views`, formData);
};

export const getMetricsOverviewAPICall = async (
	projectId: string,
	formData: DateRangeQuery,
): Promise<AxiosResponse<GetMetricsOverviewResponse>> => {
	return POST(config.apiPath + `/projects/${projectId}/dashboard/metrics_overview`, formData);
};
