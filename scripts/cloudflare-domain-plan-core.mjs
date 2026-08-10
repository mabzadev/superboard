function required(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  return value;
}

export function expectedDomainOwners(target, environment) {
  const publicRouting = target.environments?.[environment]?.publicRouting;
  if (publicRouting === "staged") return [];
  if (publicRouting !== "active") {
    throw new Error(
      `environments.${environment}.publicRouting must be active or staged`,
    );
  }
  const entries = [
    ["api", target.domains.api, target.workers.api?.[environment]],
    [
      "shortlinks",
      target.domains.shortlinks,
      target.workers.api?.[environment],
    ],
    ["sdk", target.domains.sdk, target.workers.api?.[environment]],
    ["files", target.domains.files, target.workers.api?.[environment]],
    [
      "dashboard",
      target.domains.dashboard,
      target.workers.dashboard?.[environment],
    ],
    ["mcp", target.domains.mcp, target.workers.mcp?.[environment]],
    ...(target.domains.mailPreview
      ? [
          [
            "mailPreview",
            target.domains.mailPreview,
            target.workers.email?.[environment],
          ],
        ]
      : []),
    ...(target.features.messaging && target.domains.messaging
      ? [
          [
            "messaging",
            target.domains.messaging,
            target.workers.messaging?.[environment],
          ],
        ]
      : []),
  ];

  const seen = new Set();
  return entries.map(([surface, rawHostname, rawService]) => {
    const hostname = required(rawHostname, `domains.${surface}`).toLowerCase();
    const service = required(rawService, `workers.${surface}.${environment}`);
    if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.includes("..")) {
      throw new Error(`domains.${surface} must be a hostname`);
    }
    if (seen.has(hostname)) {
      throw new Error(`Public domain ${hostname} is assigned more than once`);
    }
    seen.add(hostname);
    return { surface, hostname, service };
  });
}

function zoneForHostname(hostname, zones) {
  return zones
    .filter(
      (zone) =>
        zone.name &&
        (hostname === zone.name || hostname.endsWith(`.${zone.name}`)),
    )
    .sort((left, right) => right.name.length - left.name.length)[0];
}

export function evaluateDomainPlan({
  expected,
  zones,
  workerDomains,
  dnsRecordsByHostname,
  dnsInspectionErrorsByHostname = {},
}) {
  return expected.map((owner) => {
    const zone = zoneForHostname(owner.hostname, zones);
    if (!zone) {
      return { ...owner, status: "zone-missing", blocking: true, dns: [] };
    }

    const assigned = workerDomains.filter(
      (domain) =>
        String(domain.hostname ?? "").toLowerCase() === owner.hostname,
    );
    const dns = (dnsRecordsByHostname[owner.hostname] ?? []).map((record) => ({
      type: record.type,
      proxied: record.proxied ?? null,
    }));
    const dnsInspectionError =
      dnsInspectionErrorsByHostname[owner.hostname] ?? null;

    if (assigned.length === 1 && assigned[0].service === owner.service) {
      return {
        ...owner,
        zone: zone.name,
        status: "managed",
        blocking: false,
        dns,
      };
    }
    if (assigned.length > 0) {
      return {
        ...owner,
        zone: zone.name,
        status: "wrong-worker",
        blocking: true,
        currentServices: assigned.map((domain) => domain.service ?? "unknown"),
        dns,
      };
    }
    if (dnsInspectionError) {
      return {
        ...owner,
        zone: zone.name,
        status: "dns-unverified",
        blocking: true,
        dns,
        dnsInspectionError,
      };
    }
    if (dns.length > 0) {
      return {
        ...owner,
        zone: zone.name,
        status: "dns-conflict",
        blocking: true,
        dns,
      };
    }
    return {
      ...owner,
      zone: zone.name,
      status: "available",
      blocking: false,
      dns,
    };
  });
}
