import { DELETE as DELETE_REQUEST, GET, POST, PUT } from "@/lib/api";
import { config } from "@/lib/config";

const path = (projectRef: string, resource = "") =>
  `${config.apiPath}/dynamic-links/projects/${projectRef}${resource}`;

const unwrap = <T>(response: { data: T | { data: T } }): T =>
  response.data && typeof response.data === "object" && "data" in response.data
    ? (response.data as { data: T }).data
    : (response.data as T);

export type DynamicLink = {
  id: string;
  slug: string;
  name: string;
  destination_url: string;
  destinations: Record<string, string>;
  campaign_id?: string | null;
  title?: string | null;
  subtitle?: string | null;
  image_url?: string | null;
  utm: Record<string, string>;
  active: boolean;
  created_at: string;
  updated_at?: string;
  campaign_name?: string | null;
  total_views?: number;
  total_opens?: number;
  total_installs?: number;
  total_reinstalls?: number;
  total_reactivations?: number;
  total_app_opens?: number;
  total_user_referred?: number;
  total_time_spent?: number;
  total_revenue?: number;
};

export type LinkCampaign = {
  id: string;
  name: string;
  slug: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type LinkStatistics = {
  filters?: Record<string, unknown>;
  totals: Record<string, number>;
  series: Array<Record<string, unknown>>;
};

export type LinkStatisticsFilters = {
  from?: string;
  to?: string;
  timezone?: string;
  interval?: string;
  platform?: string;
  campaign_id?: string;
};

export type CampaignAnalyticsRow = LinkCampaign & {
  total_views: number;
  total_opens: number;
  total_installs: number;
  total_reinstalls: number;
  total_reactivations: number;
  total_app_opens: number;
  total_user_referred: number;
  total_revenue: number;
};

export type RedirectRule = {
  id: string;
  priority: number;
  name: string;
  rule: Record<string, unknown>;
  active: boolean;
};

export type LinkDomain = {
  id: string;
  hostname: string;
  status: string;
  verification_token: string;
  verified_at?: string | null;
  is_default: number;
};

export type TrackingSettings = {
  enabled: boolean;
  provider: string;
  configuration: Record<string, unknown>;
  updated_at?: string;
};

function withQuery(resource: string, values: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) query.set(key, value);
  }
  const serialized = query.toString();
  return serialized ? `${resource}?${serialized}` : resource;
}

function numericValue(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

/**
 * Maps the canonical statistics vocabulary while accepting the richer event
 * names emitted by newer SDKs. This keeps the dashboard compatible during the
 * event-schema rollout without calling any legacy analytics endpoint.
 */
export function toCampaignAnalytics(
  campaign: LinkCampaign,
  statistics: LinkStatistics,
): CampaignAnalyticsRow {
  const totals: Record<string, unknown> = {
    ...campaign.metadata,
    ...statistics.totals,
  };

  return {
    ...campaign,
    total_views: numericValue(totals, "views", "view", "clicks", "click"),
    total_opens: numericValue(totals, "opens", "open"),
    total_installs: numericValue(totals, "installs", "install"),
    total_reinstalls: numericValue(totals, "reinstalls", "reinstall"),
    total_reactivations: numericValue(
      totals,
      "reactivations",
      "reactivation",
    ),
    total_app_opens: numericValue(totals, "app_opens", "app_open"),
    total_user_referred: numericValue(
      totals,
      "users_referred",
      "user_referred",
      "conversions",
      "conversion",
    ),
    total_revenue: numericValue(
      totals,
      "revenue_cents",
      "total_revenue",
      "revenue",
    ),
  };
}

export async function getLinks(
  projectRef: string,
  search = "",
  active?: boolean,
  filters: Pick<LinkStatisticsFilters, "from" | "to" | "platform"> = {},
) {
  return unwrap<DynamicLink[]>(
    await GET(
      path(
        projectRef,
        withQuery("/links", {
          search: search || undefined,
          active: active === undefined ? undefined : String(active),
          from: filters.from,
          to: filters.to,
          platform: filters.platform,
        }),
      ),
    ),
  );
}

export async function createLink(
  projectRef: string,
  payload: Record<string, unknown>,
) {
  return unwrap<{ id: string; slug: string }>(
    await POST(path(projectRef, "/links"), payload),
  );
}

export async function deleteLink(projectRef: string, id: string) {
  return unwrap(await DELETE_REQUEST(path(projectRef, `/links/${id}`)));
}

export async function updateLink(
  projectRef: string,
  id: string,
  payload: Record<string, unknown>,
) {
  return unwrap<DynamicLink>(
    await PUT(path(projectRef, `/links/${id}`), payload),
  );
}

export async function resolveLink(
  projectRef: string,
  slug: string,
  platform: string,
) {
  return unwrap<{ destination_url: string }>(
    await POST(path(projectRef, `/links/${slug}/resolve`), { platform }),
  );
}

export async function getLinkCampaigns(projectRef: string) {
  return unwrap<LinkCampaign[]>(await GET(path(projectRef, "/campaigns")));
}

export async function getLinkCampaignAnalytics(
  projectRef: string,
  filters: Omit<LinkStatisticsFilters, "campaign_id"> = {},
) {
  const campaigns = await getLinkCampaigns(projectRef);
  return Promise.all(
    campaigns.map(async (campaign) => {
      const statistics = await getLinkStatistics(projectRef, {
        ...filters,
        campaign_id: campaign.id,
      });
      return toCampaignAnalytics(campaign, statistics);
    }),
  );
}

export async function createLinkCampaign(
  projectRef: string,
  payload: Record<string, unknown>,
) {
  return unwrap<{ id: string }>(
    await POST(path(projectRef, "/campaigns"), payload),
  );
}

export async function deleteLinkCampaign(projectRef: string, id: string) {
  return unwrap(await DELETE_REQUEST(path(projectRef, `/campaigns/${id}`)));
}

export async function getRedirectRules(projectRef: string) {
  return unwrap<RedirectRule[]>(
    await GET(path(projectRef, "/redirect-rules")),
  );
}

export async function createRedirectRule(
  projectRef: string,
  payload: Record<string, unknown>,
) {
  return unwrap<{ id: string }>(
    await POST(path(projectRef, "/redirect-rules"), payload),
  );
}

export async function updateRedirectRule(
  projectRef: string,
  id: string,
  payload: Record<string, unknown>,
) {
  return unwrap<{ id: string }>(
    await PUT(path(projectRef, `/redirect-rules/${id}`), payload),
  );
}

export async function deleteRedirectRule(projectRef: string, id: string) {
  return unwrap(
    await DELETE_REQUEST(path(projectRef, `/redirect-rules/${id}`)),
  );
}

export async function getDomains(projectRef: string) {
  return unwrap<LinkDomain[]>(await GET(path(projectRef, "/domains")));
}

export async function createDomain(
  projectRef: string,
  payload: Record<string, unknown>,
) {
  return unwrap<LinkDomain>(
    await POST(path(projectRef, "/domains"), payload),
  );
}

export async function verifyDomain(
  projectRef: string,
  id: string,
  verified = true,
) {
  return unwrap<{ verified: boolean }>(
    await POST(path(projectRef, `/domains/${id}/verify`), { verified }),
  );
}

export async function deleteDomain(projectRef: string, id: string) {
  return unwrap(await DELETE_REQUEST(path(projectRef, `/domains/${id}`)));
}

export async function getSocialPreview(projectRef: string) {
  return unwrap<{
    title: string;
    description?: string;
    image_url?: string;
    site_name?: string;
  } | null>(await GET(path(projectRef, "/social-preview")));
}

export async function saveSocialPreview(
  projectRef: string,
  payload: Record<string, unknown>,
) {
  return unwrap(await PUT(path(projectRef, "/social-preview"), payload));
}

export async function getTracking(projectRef: string) {
  return unwrap<TrackingSettings>(await GET(path(projectRef, "/tracking")));
}

export async function saveTracking(
  projectRef: string,
  payload: Record<string, unknown>,
) {
  return unwrap(await PUT(path(projectRef, "/tracking"), payload));
}

export async function getLinkStatistics(
  projectRef: string,
  filters: LinkStatisticsFilters = {},
) {
  return unwrap<LinkStatistics>(
    await GET(
      path(
        projectRef,
        withQuery("/statistics", {
          from: filters.from,
          to: filters.to,
          timezone: filters.timezone,
          interval: filters.interval,
          platform: filters.platform,
          campaign_id: filters.campaign_id,
        }),
      ),
    ),
  );
}
