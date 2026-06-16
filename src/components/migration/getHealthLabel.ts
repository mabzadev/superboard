import type { MigrationSource } from "@/types";

export type HealthTone = "green" | "amber" | "grey";

export interface HealthLabel {
  tone: HealthTone;
  label: string;
  description: string;
}

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const AUTO_DISABLE_FAILURE_THRESHOLD = 500;

/**
 * Pure helper that turns a MigrationSource's health/enabled/failure fields
 * into a user-facing badge {tone, label, description}.
 *
 * The "auto-disabled vs admin-paused" split is heuristic-only — the backend
 * doesn't tell us *why* enabled was flipped to false, so we infer it from
 * the failure counters:
 *   - consecutive_failures >= 500, OR
 *   - first_failure_at older than 2 days
 *   → "Auto-disabled" (amber, rotate hint)
 *
 * Otherwise enabled:false with zero failures is treated as an admin pause.
 */
export function getHealthLabel(source: MigrationSource): HealthLabel {
  if (source.health === "healthy") {
    return {
      tone: "green",
      label: "Active",
      description: "Old links are resolving normally.",
    };
  }

  if (source.health === "degraded") {
    return {
      tone: "amber",
      label: "Degraded",
      description: "Some requests to the legacy provider are failing.",
    };
  }

  // health === "disabled"
  const failuresOverThreshold =
    source.consecutive_failures >= AUTO_DISABLE_FAILURE_THRESHOLD;

  const firstFailureOlderThanTwoDays = (() => {
    if (source.first_failure_at === null) return false;
    const failureAt = Date.parse(source.first_failure_at);
    if (Number.isNaN(failureAt)) return false;
    return Date.now() - failureAt > TWO_DAYS_MS;
  })();

  if (failuresOverThreshold || firstFailureOlderThanTwoDays) {
    return {
      tone: "amber",
      label: "Auto-disabled",
      description:
        "We stopped contacting the legacy provider after repeated failures. Rotate the credentials to resume.",
    };
  }

  return {
    tone: "grey",
    label: "Paused",
    description: "Migration source is paused. Resume to re-enable.",
  };
}
