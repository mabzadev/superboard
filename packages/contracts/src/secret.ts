/**
 * Compare secrets without an early return on their content or original length.
 * Cloudflare exposes SubtleCrypto.timingSafeEqual; Node Web Crypto does not, so
 * CI falls back to native HMAC verification over fixed-size SHA-256 digests.
 */
export async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (left: ArrayBuffer, right: ArrayBuffer) => boolean;
  };
  const [leftDigest, rightDigest] = await Promise.all([
    subtle.digest("SHA-256", encoder.encode(left)),
    subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual.call(subtle, leftDigest, rightDigest);
  }

  const comparisonKey = await subtle.importKey(
    "raw",
    encoder.encode("opengrow-timing-safe-compare-v1"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const signature = await subtle.sign("HMAC", comparisonKey, leftDigest);
  return subtle.verify("HMAC", comparisonKey, signature, rightDigest);
}

export type SecretCandidates =
  | string
  | readonly (string | null | undefined)[];

/**
 * Return non-empty current/overlap values without changing their order. The
 * first value remains the only signing value; every value may be accepted by a
 * consumer during a bounded rotation window.
 */
export function configuredSecrets(
  ...values: readonly (string | null | undefined)[]
): string[] {
  return values.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

/** Compare against every configured candidate so the matching slot is not an
 * observable early-return branch. */
export async function matchesAnySecret(
  provided: string,
  candidates: SecretCandidates,
): Promise<boolean> {
  if (!provided) return false;
  const values = typeof candidates === "string"
    ? configuredSecrets(candidates)
    : configuredSecrets(...candidates);
  if (values.length === 0) return false;
  const matches = await Promise.all(
    values.map((candidate) => constantTimeEqual(provided, candidate)),
  );
  return matches.some(Boolean);
}
