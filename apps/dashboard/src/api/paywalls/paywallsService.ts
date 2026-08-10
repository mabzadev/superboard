import { DELETE, GET, POST, PUT } from "@/lib/api";
import { config } from "@/lib/config";

const path = (projectRef: string, resource = "") =>
  `${config.apiPath}/paywalls/projects/${projectRef}${resource}`;

const unwrap = <T>(response: { data: T | { data: T } }): T =>
  response.data && typeof response.data === "object" && "data" in response.data
    ? (response.data as { data: T }).data
    : (response.data as T);

export type ExperienceTheme = {
  accent_color: string;
  background_color: string;
  text_color: string;
  font_family: string;
  corner_radius: number;
};

export type PaywallBlock = {
  id: string;
  type:
    | "heading"
    | "text"
    | "image"
    | "product"
    | "button"
    | "close"
    | "legal"
    | "spacer";
  props: Record<string, unknown>;
};

export type PaywallDefinition = {
  schema_version: 1;
  theme: ExperienceTheme;
  components: PaywallBlock[];
  metadata: Record<string, unknown>;
};

export type Paywall = {
  id: string;
  identifier: string;
  display_name?: string;
  name?: string;
  description?: string | null;
  published_version?: number | null;
  version_count?: number;
  updated_at?: string;
};

export type PaywallVersion = {
  id: string;
  paywall_id: string;
  version: number;
  status: "draft" | "published" | "archived";
  definition: PaywallDefinition;
  changelog?: string | null;
  published_at?: string | null;
  created_at: string;
};

export type PaywallPlacement = {
  id: string;
  key: string;
  paywall_id: string;
  paywall_identifier?: string;
  active_version_id?: string | null;
  experience_id?: string | null;
  targeting: {
    platforms: string[];
    locales: string[];
    countries: string[];
    attributes: Record<string, string | number | boolean>;
  };
  priority: number;
  active: boolean;
};

export type PaywallExperience = {
  id: string;
  paywall_id: string;
  name: string;
  status: "draft" | "running" | "paused" | "completed" | "archived";
  traffic_percent: number;
  variants: Array<{
    id: string;
    key: string;
    version_id: string;
    weight: number;
    active: boolean;
  }>;
};

export type PaywallStatistics = {
  filters: Record<string, unknown>;
  totals: Record<string, unknown> & {
    conversion_rate: number;
    revenue_micros: number | null;
    revenue_by_currency: Record<string, number>;
  };
  series: Array<Record<string, unknown>>;
};

export async function getPaywalls(projectRef: string) {
  return unwrap<Paywall[]>(await GET(path(projectRef)));
}

export async function createPaywall(
  projectRef: string,
  payload: Pick<Paywall, "identifier"> & {
    display_name: string;
    description?: string;
  }
) {
  return unwrap<Paywall>(await POST(path(projectRef), payload));
}

export async function updatePaywall(
  projectRef: string,
  paywallId: string,
  payload: Pick<Paywall, "identifier"> & {
    display_name: string;
    description?: string | null;
  }
) {
  return unwrap<Paywall>(
    await PUT(path(projectRef, `/paywalls/${paywallId}`), payload)
  );
}

export async function archivePaywall(projectRef: string, paywallId: string) {
  return unwrap<{ id: string; archived: true }>(
    await DELETE(path(projectRef, `/paywalls/${paywallId}`))
  );
}

export async function getPaywallVersions(
  projectRef: string,
  paywallId: string
) {
  return unwrap<PaywallVersion[]>(
    await GET(path(projectRef, `/paywalls/${paywallId}/versions`))
  );
}

export async function createPaywallVersion(
  projectRef: string,
  paywallId: string,
  definition: PaywallDefinition,
  changelog?: string
) {
  return unwrap<PaywallVersion>(
    await POST(path(projectRef, `/paywalls/${paywallId}/versions`), {
      definition,
      changelog,
    })
  );
}

export async function publishPaywallVersion(
  projectRef: string,
  paywallId: string,
  versionId: string
) {
  return unwrap<PaywallVersion>(
    await POST(
      path(projectRef, `/paywalls/${paywallId}/versions/${versionId}/publish`),
      {}
    )
  );
}

export async function archivePaywallVersion(
  projectRef: string,
  paywallId: string,
  versionId: string
) {
  return unwrap<{ id: string; status: "archived" }>(
    await POST(
      path(projectRef, `/paywalls/${paywallId}/versions/${versionId}/archive`),
      {}
    )
  );
}

export async function getPaywallPlacements(projectRef: string) {
  return unwrap<PaywallPlacement[]>(await GET(path(projectRef, "/placements")));
}

export async function savePaywallPlacement(
  projectRef: string,
  payload: Omit<PaywallPlacement, "id" | "paywall_identifier">,
  id?: string
) {
  const resource = id ? `/placements/${id}` : "/placements";
  return unwrap<PaywallPlacement>(
    id
      ? await PUT(path(projectRef, resource), payload)
      : await POST(path(projectRef, resource), payload)
  );
}

export async function deletePaywallPlacement(projectRef: string, id: string) {
  return unwrap<{ id: string; active: false }>(
    await DELETE(path(projectRef, `/placements/${id}`))
  );
}

export async function getPaywallExperiences(projectRef: string) {
  return unwrap<PaywallExperience[]>(
    await GET(path(projectRef, "/experiences"))
  );
}

export async function createPaywallExperience(
  projectRef: string,
  payload: Omit<PaywallExperience, "id">
) {
  return unwrap<PaywallExperience>(
    await POST(path(projectRef, "/experiences"), payload)
  );
}

export async function updatePaywallExperience(
  projectRef: string,
  experienceId: string,
  payload: Omit<PaywallExperience, "id">
) {
  return unwrap<PaywallExperience>(
    await PUT(path(projectRef, `/experiences/${experienceId}`), payload)
  );
}

export async function archivePaywallExperience(
  projectRef: string,
  experienceId: string
) {
  return unwrap<{ id: string; status: "archived" }>(
    await DELETE(path(projectRef, `/experiences/${experienceId}`))
  );
}

export async function getPaywallStatistics(
  projectRef: string,
  filters: Record<string, string> = {}
) {
  const query = new URLSearchParams(filters).toString();
  return unwrap<PaywallStatistics>(
    await GET(path(projectRef, `/statistics${query ? `?${query}` : ""}`))
  );
}
