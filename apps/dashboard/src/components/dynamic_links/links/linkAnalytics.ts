import type { DynamicLink } from "@/api/dynamic-links/dynamicLinksService";
import type { Link } from "@/types";

export type LinkData = Link & {
  total_app_opens: number;
  total_user_referred: number;
};

function numberFrom(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

export function toLinkData(link: DynamicLink): LinkData {
  const values = link as unknown as Record<string, unknown>;
  const tags = Array.isArray(values.tags)
    ? values.tags.filter((tag): tag is string => typeof tag === "string")
    : typeof link.utm.tags === "string"
      ? link.utm.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
      : [];

  return {
    id: link.id,
    name: link.name,
    path: link.slug,
    active: link.active,
    ads_platform:
      typeof link.utm.source === "string" ? link.utm.source : "quick-link",
    tags,
    title: link.title ?? undefined,
    subtitle: link.subtitle ?? undefined,
    image: link.image_url ?? undefined,
    data: link.destinations,
    campaign_id: link.campaign_id ?? undefined,
    tracking_source:
      typeof link.utm.source === "string" ? link.utm.source : undefined,
    tracking_medium:
      typeof link.utm.medium === "string" ? link.utm.medium : undefined,
    tracking_campaign:
      typeof link.utm.campaign === "string" ? link.utm.campaign : undefined,
    total_views: numberFrom(values, "total_views", "views", "clicks"),
    total_opens: numberFrom(values, "total_opens", "opens"),
    total_installs: numberFrom(values, "total_installs", "installs"),
    total_reinstalls: numberFrom(values, "total_reinstalls", "reinstalls"),
    total_reactivations: numberFrom(
      values,
      "total_reactivations",
      "reactivations",
    ),
    total_app_opens: numberFrom(values, "total_app_opens", "app_opens"),
    total_user_referred: numberFrom(
      values,
      "total_user_referred",
      "users_referred",
    ),
    total_time_spent: numberFrom(values, "total_time_spent", "time_spent"),
    total_revenue: numberFrom(values, "total_revenue", "revenue_cents"),
    created_at: link.created_at,
    updated_at: link.updated_at ?? link.created_at,
  };
}
