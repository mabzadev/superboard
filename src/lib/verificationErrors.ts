// `verification_errors` arrives as one of: string, string[], record, null.
// Flatten any shape into a string[] so render paths never branch on type.
// Object keys are preserved as prefixes ("dns: CNAME mismatch") so operators
// can see which check failed. Shared by the migration wizard and the custom
// domain dialog — keep the one copy here so the two surfaces can't drift.
// Cloudflare notices that merely restate what the DNS setup checklist already
// instructs. For zones whose DNS is hosted on Cloudflare, CF reports the
// "point the CNAME at the SaaS zone" situation as an error blob even though
// it is the expected mid-setup state — surfacing it verbatim reads like
// something went wrong. The checklist (CNAME step + ownership hint) already
// communicates the action, so these are dropped from the setup view. The
// failure surface keeps the unfiltered list.
const REDUNDANT_SETUP_NOTICES = [
  /custom hostname does not CNAME to this zone/i,
  /cannot be activated with an? (?:TXT|HTTP)[^.]*validation token/i,
  /the DNS target needs to point to the SaaS zone/i,
];

// The backend joins Cloudflare's error list with "; " into one string; split
// it back apart so notices can be filtered and rendered individually.
export function setupVerificationNotices(value: unknown): string[] {
  return normalizeVerificationErrors(value)
    .flatMap((entry) => entry.split(/;\s+/))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter(
      (entry) => !REDUNDANT_SETUP_NOTICES.some((pattern) => pattern.test(entry))
    )
    .filter((entry, index, all) => all.indexOf(entry) === index);
}

export function normalizeVerificationErrors(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") {
    return value.trim().length > 0 ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeVerificationErrors(item));
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, item]) =>
        normalizeVerificationErrors(item).map((message) => `${key}: ${message}`)
    );
  }
  return [String(value)];
}
