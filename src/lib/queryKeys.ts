import type {
  GetLinksParams,
  GetCampaignsParams,
  DateRangeQuery,
  GetRevenueParams,
  GetMessagingParams,
  GetVisitorsParams,
} from "@/types";
import type {
  EventsSearchPayload,
  EventsSortedPayload,
  LinksByIdsPayload,
} from "@/types";

export const queryKeys = {
  projects: {
    all: ["projects"] as const,
    detail: (projectId: string) =>
      [...queryKeys.projects.all, projectId] as const,
    links: (projectId: string, params?: GetLinksParams) =>
      [...queryKeys.projects.detail(projectId), "links", params] as const,
    linksByIds: (projectId: string, ids: LinksByIdsPayload) =>
      [...queryKeys.projects.detail(projectId), "linksByIds", ids] as const,
    pathAvailable: (projectId: string, path: string) =>
      [...queryKeys.projects.detail(projectId), "pathAvailable", path] as const,
    randomPath: (projectId: string) =>
      [...queryKeys.projects.detail(projectId), "randomPath"] as const,
    campaigns: (projectId: string, params?: GetCampaignsParams) =>
      [...queryKeys.projects.detail(projectId), "campaigns", params] as const,
    campaignMetrics: (projectId: string, params?: DateRangeQuery) =>
      [
        ...queryKeys.projects.detail(projectId),
        "campaignMetrics",
        params,
      ] as const,
    topLinks: (projectId: string, params?: DateRangeQuery) =>
      [...queryKeys.projects.detail(projectId), "topLinks", params] as const,
    linksViews: (projectId: string, params?: DateRangeQuery) =>
      [...queryKeys.projects.detail(projectId), "linksViews", params] as const,
    metricsOverview: (projectId: string, params?: DateRangeQuery) =>
      [
        ...queryKeys.projects.detail(projectId),
        "metricsOverview",
        params,
      ] as const,
    purchases: (projectId: string, params?: GetRevenueParams) =>
      [...queryKeys.projects.detail(projectId), "purchases", params] as const,
    revenueMetrics: (projectId: string, params?: GetRevenueParams) =>
      [
        ...queryKeys.projects.detail(projectId),
        "revenueMetrics",
        params,
      ] as const,
    notifications: (projectId: string, params?: GetMessagingParams) =>
      [
        ...queryKeys.projects.detail(projectId),
        "notifications",
        params,
      ] as const,
    events: (projectId: string, params?: EventsSearchPayload) =>
      [...queryKeys.projects.detail(projectId), "events", params] as const,
    eventsSorted: (projectId: string, params?: EventsSortedPayload) =>
      [
        ...queryKeys.projects.detail(projectId),
        "eventsSorted",
        params,
      ] as const,
    eventsOverview: (projectId: string, params?: DateRangeQuery) =>
      [
        ...queryKeys.projects.detail(projectId),
        "eventsOverview",
        params,
      ] as const,
    eventsPayment: (projectId: string, params?: DateRangeQuery) =>
      [
        ...queryKeys.projects.detail(projectId),
        "eventsPayment",
        params,
      ] as const,
    metricValues: (projectId: string) =>
      [...queryKeys.projects.detail(projectId), "metricValues"] as const,
    visitors: (projectId: string, params?: GetVisitorsParams) =>
      [...queryKeys.projects.detail(projectId), "visitors", params] as const,
    aggregatedVisitors: (projectId: string, params?: GetVisitorsParams) =>
      [
        ...queryKeys.projects.detail(projectId),
        "aggregatedVisitors",
        params,
      ] as const,
    visitorDetails: (projectId: string, visitorId: string) =>
      [
        ...queryKeys.projects.detail(projectId),
        "visitorDetails",
        visitorId,
      ] as const,
    redirectConfig: (projectId: string) =>
      [...queryKeys.projects.detail(projectId), "redirectConfig"] as const,
    domainConfig: (projectId: string) =>
      [...queryKeys.projects.detail(projectId), "domainConfig"] as const,
    domainDefaults: (projectId: string) =>
      [...queryKeys.projects.detail(projectId), "domainDefaults"] as const,
  },

  instances: {
    all: ["instances"] as const,
    detail: (instanceId: string) =>
      [...queryKeys.instances.all, instanceId] as const,
    members: (instanceId: string) =>
      [...queryKeys.instances.detail(instanceId), "members"] as const,
    config: (instanceId: string) =>
      [...queryKeys.instances.detail(instanceId), "config"] as const,
    userRole: (instanceId: string) =>
      [...queryKeys.instances.detail(instanceId), "userRole"] as const,
    setupProgress: (instanceId: string, category: string) =>
      [
        ...queryKeys.instances.detail(instanceId),
        "setupProgress",
        category,
      ] as const,
  },

  payments: {
    subscription: (instanceId: string) =>
      ["payments", "subscription", instanceId] as const,
    mau: (instanceId: string) => ["payments", "mau", instanceId] as const,
    usage: (instanceId: string) => ["payments", "usage", instanceId] as const,
    dashboardUrl: (instanceId: string) =>
      ["payments", "dashboardUrl", instanceId] as const,
  },

  user: {
    current: ["user", "current"] as const,
    otpEnabled: (email: string) => ["user", "otpEnabled", email] as const,
    otpQrCode: ["user", "otpQrCode"] as const,
  },
} as const;
