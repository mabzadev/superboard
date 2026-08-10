import {
  cloudflareAccountId,
  environmentFromArgs,
  loadTarget,
  parseArgs,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";
import {
  evaluateDomainPlan,
  expectedDomainOwners,
} from "./cloudflare-domain-plan-core.mjs";

const args = parseArgs();
const targetName = targetNameFromArgs(args);
const environment = environmentFromArgs(args);
const { target } = await loadTarget(targetName);
const accountId = cloudflareAccountId(target, process.env);
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!apiToken)
  throw new Error(
    "CLOUDFLARE_API_TOKEN is required for the read-only domain plan",
  );

const expected = expectedDomainOwners(target, environment);
const zones = await listAll("/zones", {
  "account.id": accountId,
  per_page: "50",
});
const workerDomains = await listAll(`/accounts/${accountId}/workers/domains`, {
  per_page: "1000",
});
const dnsRecordsByHostname = {};
const dnsInspectionErrorsByHostname = {};

for (const owner of expected) {
  const zone = zones
    .filter(
      (candidate) =>
        candidate.name &&
        (owner.hostname === candidate.name ||
          owner.hostname.endsWith(`.${candidate.name}`)),
    )
    .sort((left, right) => right.name.length - left.name.length)[0];
  dnsRecordsByHostname[owner.hostname] = [];
  if (zone?.id) {
    try {
      dnsRecordsByHostname[owner.hostname] = await listAll(
        `/zones/${zone.id}/dns_records`,
        {
          name: owner.hostname,
          per_page: "100",
        },
      );
    } catch (error) {
      dnsInspectionErrorsByHostname[owner.hostname] =
        error instanceof Error
          ? error.message
          : "Cloudflare DNS inspection failed";
    }
  }
}

const domains = evaluateDomainPlan({
  expected,
  zones,
  workerDomains,
  dnsRecordsByHostname,
  dnsInspectionErrorsByHostname,
});
console.log(
  JSON.stringify(
    {
      target: targetName,
      environment,
      publicRouting: target.environments[environment].publicRouting,
      readOnly: true,
      domains,
    },
    null,
    2,
  ),
);

if (args.strict && domains.some((domain) => domain.blocking)) {
  throw new Error(
    "Domain ownership conflicts must be resolved explicitly before deployment",
  );
}

async function listAll(pathname, query) {
  const collected = [];
  let page = 1;
  let totalPages = 1;
  do {
    const url = new URL(`https://api.cloudflare.com/client/v4${pathname}`);
    for (const [key, value] of Object.entries({
      ...query,
      page: String(page),
    })) {
      url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      const errors = Array.isArray(payload?.errors)
        ? payload.errors.map(
            (error) =>
              `${error.code ?? "unknown"}: ${error.message ?? "Cloudflare API error"}`,
          )
        : [`HTTP ${response.status}`];
      throw new Error(
        `Cloudflare read failed for ${pathname}: ${errors.join("; ")}`,
      );
    }
    collected.push(...(Array.isArray(payload.result) ? payload.result : []));
    totalPages = Number(payload.result_info?.total_pages ?? 1);
    page += 1;
  } while (page <= totalPages);
  return collected;
}
