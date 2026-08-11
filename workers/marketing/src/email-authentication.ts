export type EmailAuthenticationResult = {
  domain: string;
  dkimSelector: string | null;
  spf: "verified" | "missing";
  dkim: "verified" | "missing" | "unconfigured";
  dmarc: "verified" | "missing";
  ready: boolean;
  checkedAt: string;
};

type DnsRecords = { txt: string[]; cnames: string[] };
type Fetcher = typeof fetch;

const DNS_ENDPOINT = "https://cloudflare-dns.com/dns-query";

export async function verifyEmailAuthentication(
  fromAddress: string,
  dkimSelector: string | null,
  fetcher: Fetcher = fetch,
): Promise<EmailAuthenticationResult> {
  const domain = senderDomain(fromAddress);
  const selector = normalizedSelector(dkimSelector);
  const [spfRecords, dmarcRecords, dkimRecords] = await Promise.all([
    resolveTxtRecords(domain, fetcher),
    resolveTxtRecords(`_dmarc.${domain}`, fetcher),
    selector
      ? resolveTxtRecords(`${selector}._domainkey.${domain}`, fetcher)
      : Promise.resolve([]),
  ]);
  const spf = spfRecords.some((record) => /^v=spf1(?:\s|$)/i.test(record))
    ? "verified"
    : "missing";
  const dmarc = dmarcRecords.some((record) =>
    /^v=dmarc1(?:;|\s|$)/i.test(record),
  )
    ? "verified"
    : "missing";
  const dkim = selector
    ? dkimRecords.some((record) => /^v=dkim1(?:;|\s|$)/i.test(record))
      ? "verified"
      : "missing"
    : "unconfigured";
  return {
    domain,
    dkimSelector: selector,
    spf,
    dkim,
    dmarc,
    ready: spf === "verified" && dkim === "verified" && dmarc === "verified",
    checkedAt: new Date().toISOString(),
  };
}

export async function resolveTxtRecords(
  name: string,
  fetcher: Fetcher = fetch,
  depth = 0,
): Promise<string[]> {
  if (depth > 4) throw new Error("DNS CNAME chain exceeded the allowed depth");
  const query = dnsQuery(name, 16);
  const url = new URL(DNS_ENDPOINT);
  url.searchParams.set("dns", base64Url(query));
  const response = await fetcher(url, {
    headers: { accept: "application/dns-message" },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok)
    throw new Error(`DNS resolver returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/dns-message")) {
    throw new Error("DNS resolver returned an unexpected content type");
  }
  const records = parseDnsMessage(await readDnsResponse(response));
  if (records.txt.length || !records.cnames.length) return records.txt;
  const nested = await Promise.all(
    records.cnames.map((target) =>
      resolveTxtRecords(target, fetcher, depth + 1),
    ),
  );
  return [...new Set(nested.flat())];
}

export function parseDnsMessage(bytes: Uint8Array): DnsRecords {
  if (bytes.length < 12) throw new Error("DNS response is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const responseCode = view.getUint16(2) & 0x000f;
  if (responseCode !== 0 && responseCode !== 3)
    throw new Error(`DNS resolver returned response code ${responseCode}`);
  const questions = view.getUint16(4);
  const answers = view.getUint16(6);
  let offset = 12;
  for (let index = 0; index < questions; index += 1) {
    offset = skipName(bytes, offset);
    ensure(bytes, offset, 4);
    offset += 4;
  }
  const records: DnsRecords = { txt: [], cnames: [] };
  for (let index = 0; index < answers; index += 1) {
    offset = skipName(bytes, offset);
    ensure(bytes, offset, 10);
    const type = view.getUint16(offset);
    const length = view.getUint16(offset + 8);
    const dataOffset = offset + 10;
    ensure(bytes, dataOffset, length);
    if (type === 16) records.txt.push(readTxt(bytes, dataOffset, length));
    if (type === 5)
      records.cnames.push(readName(bytes, dataOffset).name.replace(/\.$/, ""));
    offset = dataOffset + length;
  }
  return records;
}

function dnsQuery(name: string, type: number): Uint8Array {
  const labels = name.toLowerCase().replace(/\.$/, "").split(".");
  if (
    labels.some(
      (label) => !label || label.length > 63 || !/^[a-z0-9_-]+$/i.test(label),
    )
  ) {
    throw new Error("Email authentication DNS name is invalid");
  }
  const encodedLabels = labels.map((label) => new TextEncoder().encode(label));
  const length =
    12 +
    encodedLabels.reduce((total, label) => total + 1 + label.length, 0) +
    1 +
    4;
  if (length > 512)
    throw new Error("Email authentication DNS name is too long");
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  crypto.getRandomValues(bytes.subarray(0, 2));
  view.setUint16(2, 0x0100);
  view.setUint16(4, 1);
  let offset = 12;
  for (const label of encodedLabels) {
    bytes[offset] = label.length;
    bytes.set(label, offset + 1);
    offset += 1 + label.length;
  }
  bytes[offset] = 0;
  view.setUint16(offset + 1, type);
  view.setUint16(offset + 3, 1);
  return bytes;
}

function readTxt(bytes: Uint8Array, offset: number, length: number): string {
  const end = offset + length;
  const chunks: string[] = [];
  while (offset < end) {
    const chunkLength = bytes[offset];
    offset += 1;
    if (offset + chunkLength > end)
      throw new Error("DNS TXT response is malformed");
    chunks.push(
      new TextDecoder().decode(bytes.subarray(offset, offset + chunkLength)),
    );
    offset += chunkLength;
  }
  return chunks.join("");
}

function skipName(bytes: Uint8Array, offset: number): number {
  while (true) {
    ensure(bytes, offset, 1);
    const length = bytes[offset];
    if (length === 0) return offset + 1;
    if ((length & 0xc0) === 0xc0) {
      ensure(bytes, offset, 2);
      return offset + 2;
    }
    if (length > 63) throw new Error("DNS name label is malformed");
    ensure(bytes, offset + 1, length);
    offset += 1 + length;
  }
}

function readName(
  bytes: Uint8Array,
  offset: number,
  visited = new Set<number>(),
): { name: string; next: number } {
  if (visited.has(offset) || visited.size > 32)
    throw new Error("DNS name compression loop detected");
  visited.add(offset);
  const labels: string[] = [];
  let cursor = offset;
  let next = offset;
  let jumped = false;
  while (true) {
    ensure(bytes, cursor, 1);
    const length = bytes[cursor];
    if (length === 0) {
      if (!jumped) next = cursor + 1;
      break;
    }
    if ((length & 0xc0) === 0xc0) {
      ensure(bytes, cursor, 2);
      const pointer = ((length & 0x3f) << 8) | bytes[cursor + 1];
      if (!jumped) next = cursor + 2;
      const nested = readName(bytes, pointer, visited);
      labels.push(nested.name.replace(/\.$/, ""));
      jumped = true;
      break;
    }
    if (length > 63) throw new Error("DNS name label is malformed");
    ensure(bytes, cursor + 1, length);
    labels.push(
      new TextDecoder().decode(bytes.subarray(cursor + 1, cursor + 1 + length)),
    );
    cursor += 1 + length;
    if (!jumped) next = cursor;
  }
  return { name: `${labels.join(".")}.`, next };
}

function senderDomain(address: string): string {
  const domain = address.trim().toLowerCase().split("@")[1] || "";
  if (
    !domain ||
    domain.length > 253 ||
    !domain.includes(".") ||
    !/^[a-z0-9.-]+$/.test(domain)
  ) {
    throw new Error("SMTP sender domain is invalid");
  }
  return domain;
}

function normalizedSelector(value: string | null): string | null {
  if (value == null || value.trim() === "") return null;
  const selector = value.trim().toLowerCase();
  if (selector.length > 63 || !/^[a-z0-9][a-z0-9_-]*$/.test(selector)) {
    throw new Error("DKIM selector is invalid");
  }
  return selector;
}

function ensure(bytes: Uint8Array, offset: number, length: number) {
  if (offset < 0 || length < 0 || offset + length > bytes.length)
    throw new Error("DNS response is truncated");
}

async function readDnsResponse(response: Response): Promise<Uint8Array> {
  const maximum = 65_535;
  const announced = Number(response.headers.get("content-length") || 0);
  if (announced > maximum) throw new Error("DNS response exceeds 65535 bytes");
  if (!response.body)
    throw new Error("DNS resolver returned an empty response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel("DNS response too large");
        throw new Error("DNS response exceeds 65535 bytes");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
