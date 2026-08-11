import { DELETE, GET, POST, PUT } from "@/lib/api";
import { config } from "@/lib/config";
const path = (projectId: string, resource = "") =>
  `${config.apiPath}/onboardings/projects/${projectId}${resource}`;
export type Onboarding = {
  id: string;
  identifier: string;
  display_name: string;
  active_version?: number | null;
  active_version_id?: string | null;
  description?: string | null;
};
export type OnboardingVersion = {
  id: string;
  version: number;
  state: "draft" | "published" | "archived";
  configuration?: Record<string, unknown>;
  created_at?: string;
  published_at?: string | null;
};
export type OnboardingPlacement = {
  id: string;
  key: string;
  name: string;
  onboarding_id: string;
  active_version_id?: string | null;
  priority: number;
  active: boolean | number;
};
export type OnboardingTargetingRule = {
  id: string;
  placement_id: string;
  name: string;
  priority: number;
  conditions: Record<string, unknown>;
  active: boolean;
};
export type OnboardingExperience = {
  id: string;
  placement_id: string;
  name: string;
  status: "draft" | "running" | "paused" | "completed";
  traffic_percentage: number;
  variants: Array<{
    id: string;
    name: string;
    weight: number;
    version_id: string;
  }>;
};
export type OnboardingStatistics = {
  filters: Record<string, unknown>;
  totals: Record<string, number>;
  series: Array<{
    date: string;
    event_type: string;
    platform?: string | null;
    placement?: string | null;
    version_id?: string | null;
    experience_id?: string | null;
    variant_id?: string | null;
    step_id?: string | null;
    count: number;
  }>;
  funnel: Array<{ step: string; count: number }>;
  completion_rate?: number;
  drop_off_rate?: number;
};
const unwrap = <T>(r: { data: T | { data: T } }): T =>
  r.data && typeof r.data === "object" && "data" in r.data
    ? (r.data as { data: T }).data
    : (r.data as T);
export async function getOnboardings(id: string) {
  return unwrap<Onboarding[]>(await GET(path(id)));
}
export async function createOnboarding(
  id: string,
  payload: Record<string, unknown>
) {
  return unwrap<Onboarding>(await POST(path(id), payload));
}
export async function updateOnboarding(
  id: string,
  onboardingId: string,
  payload: Pick<Onboarding, "display_name" | "description">
) {
  return unwrap<Onboarding>(await PUT(path(id, `/${onboardingId}`), payload));
}
export async function deleteOnboarding(id: string, onboardingId: string) {
  return unwrap<{ deleted: boolean }>(
    await DELETE(path(id, `/${onboardingId}`))
  );
}
export async function getOnboardingVersions(id: string, onboardingId: string) {
  return unwrap<OnboardingVersion[]>(
    await GET(path(id, `/${onboardingId}/versions`))
  );
}
export async function createOnboardingVersion(
  id: string,
  onboardingId: string,
  payload: Record<string, unknown>
) {
  return unwrap<OnboardingVersion>(
    await POST(path(id, `/${onboardingId}/versions`), payload)
  );
}
export async function publishOnboarding(
  id: string,
  onboardingId: string,
  versionId: string
) {
  return unwrap<Onboarding>(
    await POST(path(id, `/${onboardingId}/publish`), { version_id: versionId })
  );
}
export async function getOnboardingStatistics(
  id: string,
  filters: Record<string, string> = {}
) {
  const query = new URLSearchParams(filters).toString();
  return unwrap<OnboardingStatistics>(
    await GET(path(id, `/statistics${query ? `?${query}` : ""}`))
  );
}
export async function getOnboardingPlacements(id: string) {
  return unwrap<OnboardingPlacement[]>(await GET(path(id, "/placements")));
}
export async function saveOnboardingPlacement(
  id: string,
  payload: Omit<OnboardingPlacement, "id">,
  placementId?: string
) {
  return unwrap<OnboardingPlacement>(
    placementId
      ? await PUT(path(id, `/placements/${placementId}`), payload)
      : await POST(path(id, "/placements"), payload)
  );
}
export async function deleteOnboardingPlacement(
  id: string,
  placementId: string
) {
  return unwrap<{ deleted: boolean }>(
    await DELETE(path(id, `/placements/${placementId}`))
  );
}
export async function getOnboardingTargetingRules(id: string) {
  return unwrap<OnboardingTargetingRule[]>(
    await GET(path(id, "/targeting-rules"))
  );
}
export async function createOnboardingTargetingRule(
  id: string,
  payload: Omit<OnboardingTargetingRule, "id">
) {
  return unwrap<OnboardingTargetingRule>(
    await POST(path(id, "/targeting-rules"), payload)
  );
}
export async function deleteOnboardingTargetingRule(
  id: string,
  ruleId: string
) {
  return unwrap<{ deleted: boolean }>(
    await DELETE(path(id, `/targeting-rules/${ruleId}`))
  );
}
export async function getOnboardingExperiences(id: string) {
  return unwrap<OnboardingExperience[]>(await GET(path(id, "/experiences")));
}
export async function createOnboardingExperience(
  id: string,
  payload: Omit<OnboardingExperience, "id">
) {
  return unwrap<OnboardingExperience>(
    await POST(path(id, "/experiences"), payload)
  );
}
export async function setOnboardingExperienceStatus(
  id: string,
  experienceId: string,
  status: OnboardingExperience["status"]
) {
  return unwrap<{ id: string; status: string }>(
    await POST(path(id, `/experiences/${experienceId}/status`), { status })
  );
}
