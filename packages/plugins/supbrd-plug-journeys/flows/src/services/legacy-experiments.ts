import type { FlowEditorBlock } from "@superboard/contracts/flows";

type Variant = { key: string; weight: number };

export async function selectLegacyExperimentVariant(
  block: FlowEditorBlock,
  subject: string,
): Promise<string | null> {
  const source = block.data.legacy_source;
  const projectId = Number(block.data.legacy_project_id);
  const placementId = String(block.data.legacy_placement_id ?? "");
  const experienceId = String(block.data.legacy_experience_id ?? "");
  const trafficBasisPoints = Math.max(
    0,
    Math.min(10_000, Number(block.data.traffic_basis_points ?? 10_000)),
  );
  if (
    (source !== "paywalls" && source !== "onboardings") ||
    !Number.isSafeInteger(projectId) ||
    !placementId ||
    !experienceId
  ) return null;
  const variants = Array.isArray(block.data.variants)
    ? block.data.variants.flatMap((entry): Variant[] => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const value = entry as Record<string, unknown>;
        return typeof value.key === "string" && typeof value.weight === "number"
          ? [{ key: value.key, weight: Math.max(0, value.weight) }]
          : [];
      })
    : [];
  if (!variants.length) return "holdout";

  const eligible = source === "onboardings"
    ? stableBucket(subject, 10_000) < trafficBasisPoints
    : (await sha256Bucket(`${projectId}:${placementId}:${subject}`, 100)) <
      Math.round(trafficBasisPoints / 100);
  if (!eligible) return "holdout";

  const total = variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (total <= 0) return "holdout";
  const bucket = source === "onboardings"
    ? stableBucket(subject, 10_000) % total
    : await sha256Bucket(`${projectId}:${experienceId}:${subject}`, total);
  let cursor = 0;
  for (const variant of variants) {
    cursor += variant.weight;
    if (bucket < cursor) return variant.key;
  }
  return variants.at(-1)?.key ?? "holdout";
}

export function stableBucket(value: string, modulo: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % Math.max(1, modulo);
}

async function sha256Bucket(value: string, modulo: number): Promise<number> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return (
    (((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0) %
    Math.max(1, modulo)
  );
}
