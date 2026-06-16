import type {
  CustomDomain,
  CustomDomainPreflight,
  CustomDomainStatus,
} from "@/types";

// DNS preflight (CNAME check) cadence — one constant shared by the custom
// domain dialog and the migration wizard so the pace can't drift between them.
// Lives here (not in useConfigurationQueries) so tests that mock the query
// module don't lose it.
export const CUSTOM_DOMAIN_PREFLIGHT_POLL_MS = 15000;

// "Still being set up" statuses: the row exists and Grovs is waiting on DNS /
// Cloudflare. Single source of truth so the dialog, the settings card, and the
// poll intervals can't disagree when the backend adds a new in-flight status.
export function isCustomDomainInFlight(
  status: CustomDomainStatus | null | undefined
): boolean {
  return status === "pending" || status === "provisioning";
}

// Failure surface: terminal-ish states the user must act on. Mirrors the
// migration wizard's rule — ssl_status "failed" means the cert didn't issue
// within Cloudflare's window even when the hostname status is still "pending".
export function isCustomDomainFailedLike(domain: CustomDomain): boolean {
  return (
    domain.status === "failed" ||
    domain.status === "suspended" ||
    domain.ssl_status === "failed"
  );
}

// The backend's preflight runs a real DNS lookup and reports failures as the
// resolver exception class name in `dns_error` (DnsCnameLookupService):
//  - "Resolv::ResolvError" — NXDOMAIN / no data: a definitive "no CNAME
//    published" answer.
//  - timeouts and transport failures (Resolv::ResolvTimeout, IOError,
//    Errno::ECONNREFUSED, SocketError) — say nothing about the record.
// Collapse that into one verdict so the UI never treats a resolver hiccup as
// proof the customer un-pointed their DNS.
export type PreflightCnameVerdict = "matched" | "not_pointed" | "inconclusive";

export function preflightCnameVerdict(
  preflight: CustomDomainPreflight | null | undefined
): PreflightCnameVerdict {
  if (!preflight || typeof preflight.cname_matches !== "boolean") {
    return "inconclusive";
  }
  if (preflight.cname_matches) return "matched";
  if (preflight.dns_error && preflight.dns_error !== "Resolv::ResolvError") {
    return "inconclusive";
  }
  return "not_pointed";
}

// Older backend deploys predate the TXT-challenge contract: they never send
// ssl_validation_txt_records (the new backend always does, even as []), have
// no ssl_status, and carry none of the legacy single-record TXT fields. For
// those payloads the only meaningful instruction is the CNAME, so the dialog
// falls back to the original CNAME-first UI instead of waiting forever for a
// TXT challenge that will never arrive.
export function isLegacyCustomDomainPayload(domain: CustomDomain): boolean {
  return (
    domain.ssl_validation_txt_records === undefined &&
    domain.ssl_status == null &&
    domain.ownership_verification_txt_name == null &&
    domain.ssl_validation_txt_value == null &&
    domain.txt_record_value == null &&
    domain.txt_record == null
  );
}
