export interface DateRangeQuery {
  start_date: string;
  end_date?: string;
  platform?: string;
}

export interface PaginatedQuery extends DateRangeQuery {
  ascending: boolean;
  page: number;
  sort_by: string;
  per_page: number;
  term?: string;
}

export interface GetLinksParams {
  active: boolean;
  sdk: boolean;
  ascending: boolean;
  page: number;
  start_date: string;
  sort_by?: string;
  ads_platform?: string;
  term?: string;
  end_date?: string;
  event_type?: string;
  campaign_id?: string;
  per_page?: number;
  platform?: string;
}

export type GetVisitorsParams = PaginatedQuery;

export interface GetCampaignsParams {
  archived: boolean;
  ascending: boolean;
  page: number;
  start_date: string;
  sort_by: string;
  per_page: number;
  term?: string;
  end_date?: string;
}

export interface GetRevenueParams {
  ascending: boolean;
  current_page: number;
  start_date: string;
  sort_by: string;
  per_page: number;
  term?: string;
  end_date?: string;
  platform?: string;
}

export interface GetMessagingParams {
  page: number;
  for_new_users: boolean | null;
  archived: boolean;
  term?: string;
}
