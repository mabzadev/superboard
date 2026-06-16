import type { CustomDomain } from "@/types";

export interface DnsTxtRecord {
  name: string;
  value: string;
}

// The backend always emits `ssl_validation_txt_records` (possibly [] right
// after create, before Cloudflare mints the ACME challenge). Older payloads
// carried a single name/value pair under various keys; fall back to those so
// the UI keeps working against stale deploys.
export function sslValidationTxtRecordsFor(
  domain: CustomDomain
): DnsTxtRecord[] {
  const records = domain.ssl_validation_txt_records
    ?.filter(
      (record) =>
        typeof record.name === "string" &&
        record.name.trim().length > 0 &&
        typeof record.value === "string" &&
        record.value.trim().length > 0
    )
    .map((record) => ({
      name: record.name.trim(),
      value: record.value.trim(),
    }));

  if (records !== undefined && records.length > 0) return records;

  const fallbackValue =
    domain.ssl_validation_txt_value ??
    domain.txt_record_value ??
    domain.txt_record ??
    null;
  if (fallbackValue == null || fallbackValue.trim().length === 0) return [];

  return [
    {
      name:
        domain.ssl_validation_txt_name ??
        domain.txt_record_name ??
        `_acme-challenge.${domain.hostname}`,
      value: fallbackValue.trim(),
    },
  ];
}
