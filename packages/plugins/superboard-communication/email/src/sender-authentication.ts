export type EmailAuthenticationResult = {
	domain: string;
	dkimSelector: string | null;
	spf: "verified" | "missing";
	dkim: "verified" | "missing" | "unconfigured";
	dmarc: "verified" | "missing";
	ready: boolean;
	checkedAt: string;
};

type DnsRecords = {
	txt: string[];
	cnames: string[];
	mx: Array<{ priority: number; exchange: string }>;
};
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
		selector ? resolveTxtRecords(`${selector}._domainkey.${domain}`, fetcher) : Promise.resolve([]),
	]);
	const spf = spfRecords.some((record) => /^v=spf1(?:\s|$)/i.test(record)) ? "verified" : "missing";
	const dmarc = dmarcRecords.some((record) => /^v=dmarc1(?:;|\s|$)/i.test(record))
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
	const records = await queryDns(name, 16, fetcher);
	if (records.txt.length || !records.cnames.length) return records.txt;
	const nested = await Promise.all(
		records.cnames.map((target) => resolveTxtRecords(target, fetcher, depth + 1)),
	);
	return [...new Set(nested.flat())];
}

/** Returns the CNAME targets published at `name` (lowercase, without the trailing dot). */
async function resolveCnameRecords(name: string, fetcher: Fetcher = fetch): Promise<string[]> {
	const records = await queryDns(name, 5, fetcher);
	return [...new Set(records.cnames.map((target) => target.toLowerCase()))];
}

async function resolveMxRecords(
	name: string,
	fetcher: Fetcher = fetch,
): Promise<Array<{ priority: number; exchange: string }>> {
	return (await queryDns(name, 15, fetcher)).mx;
}

async function queryDns(name: string, type: number, fetcher: Fetcher): Promise<DnsRecords> {
	const query = dnsQuery(name, type);
	const url = new URL(DNS_ENDPOINT);
	url.searchParams.set("dns", base64Url(query));
	const response = await fetcher(url, {
		headers: { accept: "application/dns-message" },
		cf: { cacheTtl: 300, cacheEverything: true },
	});
	if (!response.ok) throw new Error(`DNS resolver returned HTTP ${response.status}`);
	const contentType = response.headers.get("content-type") || "";
	if (!contentType.toLowerCase().includes("application/dns-message")) {
		throw new Error("DNS resolver returned an unexpected content type");
	}
	return parseDnsMessage(await readDnsResponse(response));
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
	const records: DnsRecords = { txt: [], cnames: [], mx: [] };
	for (let index = 0; index < answers; index += 1) {
		offset = skipName(bytes, offset);
		ensure(bytes, offset, 10);
		const type = view.getUint16(offset);
		const length = view.getUint16(offset + 8);
		const dataOffset = offset + 10;
		ensure(bytes, dataOffset, length);
		if (type === 16) records.txt.push(readTxt(bytes, dataOffset, length));
		if (type === 5) records.cnames.push(readName(bytes, dataOffset).name.replace(/\.$/, ""));
		if (type === 15 && length >= 3)
			records.mx.push({
				priority: view.getUint16(dataOffset),
				exchange: readName(bytes, dataOffset + 2)
					.name.replace(/\.$/, "")
					.toLowerCase(),
			});
		offset = dataOffset + length;
	}
	return records;
}

function dnsQuery(name: string, type: number): Uint8Array {
	const labels = name.toLowerCase().replace(/\.$/, "").split(".");
	if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9_-]+$/i.test(label))) {
		throw new Error("Email authentication DNS name is invalid");
	}
	const encodedLabels = labels.map((label) => new TextEncoder().encode(label));
	const length = 12 + encodedLabels.reduce((total, label) => total + 1 + label.length, 0) + 1 + 4;
	if (length > 512) throw new Error("Email authentication DNS name is too long");
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
		if (offset + chunkLength > end) throw new Error("DNS TXT response is malformed");
		chunks.push(new TextDecoder().decode(bytes.subarray(offset, offset + chunkLength)));
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
		labels.push(new TextDecoder().decode(bytes.subarray(cursor + 1, cursor + 1 + length)));
		cursor += 1 + length;
		if (!jumped) next = cursor;
	}
	return { name: `${labels.join(".")}.`, next };
}

function senderDomain(address: string): string {
	const domain = address.trim().toLowerCase().split("@")[1] || "";
	if (!domain || domain.length > 253 || !domain.includes(".") || !/^[a-z0-9.-]+$/.test(domain)) {
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
	if (!response.body) throw new Error("DNS resolver returned an empty response");
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
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/* -------------------------------------------------------------------------- */
/* Domain authentication wizard                                               */
/* -------------------------------------------------------------------------- */

type EmailAuthenticationProvider = "smtp" | "aws-ses";
export type DomainAuthenticationConfig = {
	/** SPF include of a custom SMTP provider, for example `_spf.mailgun.org`. */
	spf_include?: string | null;
	/** DKIM record published by a custom SMTP provider. */
	dkim_type?: "txt" | "cname" | null;
	dkim_selector?: string | null;
	/** Expected TXT public key (`v=DKIM1; k=rsa; p=…`) or CNAME target. */
	dkim_value?: string | null;
	/** Amazon SES Easy DKIM tokens shown by the SES console. */
	dkim_tokens?: string[];
	/** DMARC aggregate report mailbox. Defaults to dmarc-reports@<domain>. */
	dmarc_rua?: string | null;
	/** Optional Amazon SES custom MAIL FROM subdomain (aligns SPF). */
	mail_from_domain?: string | null;
};
type DnsRecordStatus = "verified" | "missing" | "mismatch" | "unconfigured";
type ExpectedDnsRecord = {
	id: string;
	purpose: "spf" | "dkim" | "dmarc" | "mail_from";
	type: "TXT" | "CNAME" | "MX";
	host: string;
	value: string;
	priority?: number;
	/** Name of the wizard input to fill when the record cannot be generated yet. */
	needs?: "spf_include" | "dkim" | "dkim_tokens";
};
type DnsRecordCheck = ExpectedDnsRecord & {
	status: DnsRecordStatus;
	found: string[];
	/** English explanation; `detail_key` + `detail_params` let clients localize it. */
	detail: string;
	detail_key: string;
	detail_params: Record<string, string>;
	aligned: boolean | null;
};
type DomainAuthenticationReport = {
	domain: string;
	provider: EmailAuthenticationProvider;
	records: DnsRecordCheck[];
	spf: DnsRecordStatus;
	dkim: DnsRecordStatus;
	dmarc: DnsRecordStatus;
	alignment: { spf: boolean; dkim: boolean; dmarc_policy: string | null };
	ready: boolean;
	checkedAt: string;
};
type DomainAuthenticationInput = {
	fromAddress: string;
	provider: EmailAuthenticationProvider;
	awsRegion?: string | null;
	config: DomainAuthenticationConfig;
};

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
const SES_DKIM_TOKEN = /^[a-z0-9]{16,64}$/;

/** Validates and normalizes wizard input. Throws `{ code }` errors for the admin API. */
export function normalizeDomainAuthenticationConfig(
	value: unknown,
	fromAddress: string,
): DomainAuthenticationConfig {
	const input: Record<string, unknown> =
		value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
	const domain = senderDomain(fromAddress);
	const text = (raw: unknown, max: number) => {
		if (raw == null || raw === "") return null;
		if (typeof raw !== "string" || raw.length > max || /[\r\n]/.test(raw))
			invalid("authentication_config_invalid");
		return raw.trim() || null;
	};
	const host = (raw: unknown, code: string) => {
		const result = text(raw, 253)?.toLowerCase().replace(/\.$/, "") ?? null;
		if (result && !HOSTNAME.test(result)) invalid(code);
		return result;
	};
	const spfInclude = host(input.spf_include, "spf_include_invalid");
	const rawDkimType = input.dkim_type;
	let dkimType: DomainAuthenticationConfig["dkim_type"] = null;
	if (rawDkimType != null && rawDkimType !== "") {
		if (rawDkimType !== "txt" && rawDkimType !== "cname") invalid("dkim_type_invalid");
		dkimType = rawDkimType;
	}
	const dkimSelector = text(input.dkim_selector, 63)?.toLowerCase() ?? null;
	if (dkimSelector && !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(dkimSelector))
		invalid("dkim_selector_invalid");
	const rawDkimValue = text(input.dkim_value, 4_096);
	const dkimValue =
		rawDkimValue && dkimType === "cname"
			? rawDkimValue.toLowerCase().replace(/\.$/, "")
			: rawDkimValue;
	if (dkimValue && dkimType === "cname" && !HOSTNAME.test(dkimValue)) invalid("dkim_value_invalid");
	if (dkimValue && dkimType !== "cname" && !/^[\x20-\x7e]+$/.test(dkimValue))
		invalid("dkim_value_invalid");
	const rawTokens = Array.isArray(input.dkim_tokens)
		? input.dkim_tokens
		: typeof input.dkim_tokens === "string"
			? input.dkim_tokens.split(/[\s,]+/)
			: [];
	const dkimTokens = [
		...new Set(rawTokens.map((token) => String(token).trim().toLowerCase()).filter(Boolean)),
	];
	if (dkimTokens.length > 3 || dkimTokens.some((token) => !SES_DKIM_TOKEN.test(token)))
		invalid("dkim_tokens_invalid");
	const dmarcRua = text(input.dmarc_rua, 254)?.toLowerCase() ?? null;
	if (dmarcRua && !/^[^\s<>@;,]+@[^\s<>@;,]+\.[^\s<>@;,]+$/.test(dmarcRua))
		invalid("dmarc_rua_invalid");
	const mailFrom = host(input.mail_from_domain, "mail_from_domain_invalid");
	if (mailFrom && !mailFrom.endsWith(`.${domain}`)) invalid("mail_from_domain_invalid");
	return {
		spf_include: spfInclude,
		dkim_type: dkimType,
		dkim_selector: dkimSelector,
		dkim_value: dkimValue,
		dkim_tokens: dkimTokens,
		dmarc_rua: dmarcRua,
		mail_from_domain: mailFrom,
	};
}

/** Generates the exact DNS records an operator must publish for a sender domain. */
export function expectedDnsRecords(input: DomainAuthenticationInput): ExpectedDnsRecord[] {
	const domain = senderDomain(input.fromAddress);
	const config = input.config;
	const records: ExpectedDnsRecord[] = [];
	if (input.provider === "aws-ses") {
		const region = String(input.awsRegion || "")
			.trim()
			.toLowerCase();
		const mailFrom = config.mail_from_domain;
		if (mailFrom) {
			records.push(
				{
					id: "mail_from_mx",
					purpose: "mail_from",
					type: "MX",
					host: mailFrom,
					priority: 10,
					value: `feedback-smtp.${region || "<region>"}.amazonses.com${region.startsWith("cn-") ? ".cn" : ""}`,
				},
				{
					id: "spf",
					purpose: "spf",
					type: "TXT",
					host: mailFrom,
					value: "v=spf1 include:amazonses.com ~all",
				},
			);
		} else {
			records.push({
				id: "spf",
				purpose: "spf",
				type: "TXT",
				host: domain,
				value: "v=spf1 include:amazonses.com ~all",
			});
		}
		const tokens = config.dkim_tokens ?? [];
		if (tokens.length) {
			tokens.forEach((token, index) =>
				records.push({
					id: `dkim_${index + 1}`,
					purpose: "dkim",
					type: "CNAME",
					host: `${token}._domainkey.${domain}`,
					value: `${token}.dkim.amazonses.com`,
				}),
			);
		} else {
			records.push({
				id: "dkim",
				purpose: "dkim",
				type: "CNAME",
				host: `<token>._domainkey.${domain}`,
				value: "<token>.dkim.amazonses.com",
				needs: "dkim_tokens",
			});
		}
	} else {
		records.push(
			config.spf_include
				? {
						id: "spf",
						purpose: "spf",
						type: "TXT",
						host: domain,
						value: `v=spf1 include:${config.spf_include} ~all`,
					}
				: {
						id: "spf",
						purpose: "spf",
						type: "TXT",
						host: domain,
						value: "v=spf1 include:<provider> ~all",
						needs: "spf_include",
					},
		);
		const selector = config.dkim_selector;
		if (selector && config.dkim_type === "cname" && config.dkim_value) {
			records.push({
				id: "dkim",
				purpose: "dkim",
				type: "CNAME",
				host: `${selector}._domainkey.${domain}`,
				value: config.dkim_value,
			});
		} else if (selector) {
			records.push({
				id: "dkim",
				purpose: "dkim",
				type: "TXT",
				host: `${selector}._domainkey.${domain}`,
				value: config.dkim_value || "v=DKIM1; k=rsa; p=<public key from your provider>",
				...(config.dkim_value ? {} : { needs: "dkim" as const }),
			});
		} else {
			records.push({
				id: "dkim",
				purpose: "dkim",
				type: "TXT",
				host: `<selector>._domainkey.${domain}`,
				value: "v=DKIM1; k=rsa; p=<public key from your provider>",
				needs: "dkim",
			});
		}
	}
	records.push({
		id: "dmarc",
		purpose: "dmarc",
		type: "TXT",
		host: `_dmarc.${domain}`,
		value: `v=DMARC1; p=none; rua=mailto:${config.dmarc_rua || `dmarc-reports@${domain}`}`,
	});
	return records;
}

/**
 * Resolves every expected record over DNS-over-HTTPS and compares VALUES, not
 * only existence: the SPF include, the DKIM key or CNAME target, the DMARC
 * policy syntax, the SES MAIL FROM MX target, and identifier alignment.
 */
export async function verifyDomainAuthentication(
	input: DomainAuthenticationInput,
	fetcher: Fetcher = fetch,
): Promise<DomainAuthenticationReport> {
	const domain = senderDomain(input.fromAddress);
	const expected = expectedDnsRecords(input);
	const records = await Promise.all(
		expected.map((record) => checkRecord(record, domain, input, fetcher)),
	);
	const statusOf = (purpose: ExpectedDnsRecord["purpose"]): DnsRecordStatus => {
		const matching = records.filter((record) => record.purpose === purpose);
		if (!matching.length) return "unconfigured";
		for (const status of ["mismatch", "missing", "unconfigured"] as const)
			if (matching.some((record) => record.status === status)) return status;
		return "verified";
	};
	const mailFrom = statusOf("mail_from");
	const spfRecord = statusOf("spf");
	const spf: DnsRecordStatus =
		mailFrom !== "unconfigured" && mailFrom !== "verified" ? mailFrom : spfRecord;
	const dkim = statusOf("dkim");
	const dmarc = statusOf("dmarc");
	const dmarcRecord = records.find((record) => record.purpose === "dmarc");
	const policy = dmarcRecord?.found.map(parseDmarc).find((tags) => tags?.p)?.p ?? null;
	const spfAligned = records.some(
		(record) => record.purpose === "spf" && record.aligned === true && record.status === "verified",
	);
	const dkimAligned = records
		.filter((record) => record.purpose === "dkim")
		.every((record) => record.aligned === true && record.status === "verified");
	return {
		domain,
		provider: input.provider,
		records,
		spf,
		dkim,
		dmarc,
		alignment: { spf: spfAligned && spf === "verified", dkim: dkimAligned, dmarc_policy: policy },
		ready:
			spf === "verified" &&
			dkim === "verified" &&
			dmarc === "verified" &&
			(dkimAligned || spfAligned),
		checkedAt: new Date().toISOString(),
	};
}

async function checkRecord(
	record: ExpectedDnsRecord,
	domain: string,
	input: DomainAuthenticationInput,
	fetcher: Fetcher,
): Promise<DnsRecordCheck> {
	const result = (
		status: DnsRecordStatus,
		found: string[],
		key: string,
		aligned: boolean | null = null,
		params: Record<string, string> = {},
	): DnsRecordCheck => ({
		...record,
		status,
		found: found.slice(0, 10).map((value) => value.slice(0, 1_024)),
		detail: key.replace(/\{(\w+)\}/g, (token, name: string) => params[name] ?? token),
		detail_key: key,
		detail_params: params,
		aligned,
	});
	if (record.purpose === "spf") {
		const found = (await resolveTxtRecords(record.host, fetcher)).filter((value) =>
			/^v=spf1(?:\s|$)/i.test(value),
		);
		// Envelope MAIL FROM is the sender address for custom SMTP, and the custom
		// MAIL FROM subdomain for SES; both are relaxed-aligned with the From domain.
		const aligned = input.provider === "smtp" || Boolean(input.config.mail_from_domain);
		if (!found.length)
			return result("missing", [], "No SPF record is published at this host.", aligned);
		if (found.length > 1)
			return result(
				"mismatch",
				found,
				"Several SPF records exist; merge them into one (RFC 7208).",
				aligned,
			);
		const spfRecord = found[0] ?? "";
		const terms = spfRecord.toLowerCase().split(/\s+/);
		if (terms.includes("+all") || terms.includes("all"))
			return result(
				"mismatch",
				found,
				"The SPF record authorizes every server (+all); use ~all or -all.",
				aligned,
			);
		const include = input.provider === "aws-ses" ? "amazonses.com" : input.config.spf_include;
		if (!include)
			return result(
				"verified",
				found,
				"A valid SPF record exists. Enter your provider's SPF include to also verify that it authorizes your provider.",
				aligned,
			);
		if (!terms.includes(`include:${include}`) && !terms.includes(`+include:${include}`)) {
			return {
				...result(
					"mismatch",
					found,
					"The SPF record does not include {include}. Use the suggested value.",
					aligned,
					{ include },
				),
				value: suggestSpfRecord(spfRecord, include),
			};
		}
		return result(
			"verified",
			found,
			aligned
				? "SPF authorizes your provider and is aligned with the sender domain."
				: "SPF authorizes Amazon SES. Configure a custom MAIL FROM domain to align SPF; DMARC passes through DKIM.",
			aligned,
		);
	}
	if (record.purpose === "mail_from") {
		const found = await resolveMxRecords(record.host, fetcher);
		const values = found.map((mx) => `${mx.priority} ${mx.exchange}`);
		if (!found.length)
			return result("missing", [], "No MX record is published for the MAIL FROM domain.");
		return found.some((mx) => mx.exchange === record.value)
			? result("verified", values, "The MAIL FROM domain routes bounces to Amazon SES.", true)
			: result("mismatch", values, "The MX record must point to {target}.", null, {
					target: record.value,
				});
	}
	if (record.purpose === "dkim") {
		if (record.needs)
			return result(
				"unconfigured",
				[],
				"Paste the DKIM details from your provider to generate this record.",
			);
		const aligned = record.host.endsWith(`._domainkey.${domain}`);
		if (record.type === "CNAME") {
			const found = await resolveCnameRecords(record.host, fetcher);
			if (!found.length)
				return result("missing", [], "No CNAME record is published at this host.", aligned);
			return found.includes(record.value.toLowerCase())
				? result(
						"verified",
						found,
						"The DKIM CNAME points to your provider's signing key.",
						aligned,
					)
				: result("mismatch", found, "The CNAME must point to {target}.", aligned, {
						target: record.value,
					});
		}
		const found = (await resolveTxtRecords(record.host, fetcher)).filter((value) =>
			/(?:^|;)\s*p=/i.test(value),
		);
		if (!found.length)
			return result("missing", [], "No DKIM public key is published at this host.", aligned);
		const expected = dkimPublicKey(record.value);
		const published = found.map(dkimPublicKey);
		if (published.every((key) => !key))
			return result("mismatch", found, "The DKIM key is empty (revoked).", aligned);
		if (expected && !published.includes(expected))
			return result(
				"mismatch",
				found,
				"The published DKIM public key differs from your provider's key.",
				aligned,
			);
		return result(
			"verified",
			found,
			"The DKIM public key matches and signs for the sender domain.",
			aligned,
		);
	}
	let found = (await resolveTxtRecords(record.host, fetcher)).filter((value) =>
		/^v=dmarc1(?:;|\s|$)/i.test(value),
	);
	let inherited = false;
	const organizational = domain.split(".").slice(-2).join(".");
	if (!found.length && organizational !== domain) {
		found = (await resolveTxtRecords(`_dmarc.${organizational}`, fetcher)).filter((value) =>
			/^v=dmarc1(?:;|\s|$)/i.test(value),
		);
		inherited = found.length > 0;
	}
	if (!found.length) return result("missing", [], "No DMARC record is published for the domain.");
	if (found.length > 1)
		return result("mismatch", found, "Several DMARC records exist; keep exactly one.");
	const tags = parseDmarc(found[0] ?? "");
	const policy = tags?.p ?? "";
	if (!["none", "quarantine", "reject"].includes(policy))
		return result(
			"mismatch",
			found,
			"The DMARC record must declare p=none, p=quarantine or p=reject.",
		);
	return inherited
		? result("verified", found, "DMARC policy inherited from {domain}: p={policy}.", true, {
				domain: organizational,
				policy,
			})
		: result("verified", found, "DMARC policy: p={policy}.", true, { policy });
}

/** Inserts a provider include into an existing SPF record, before its `all` term. */
export function suggestSpfRecord(existing: string, include: string): string {
	const terms = existing.trim().split(/\s+/);
	const allIndex = terms.findIndex((term) => /^[~?+-]?all$/i.test(term));
	const mechanism = `include:${include}`;
	if (allIndex === -1) return [...terms, mechanism, "~all"].join(" ");
	terms.splice(allIndex, 0, mechanism);
	return terms.join(" ");
}

function dkimPublicKey(value: string): string | null {
	const match = /(?:^|;)\s*p=([^;]*)/i.exec(value);
	if (!match) return null;
	const key = (match[1] ?? "").replace(/[\s"]+/g, "");
	return key || null;
}

function parseDmarc(value: string): Record<string, string> | null {
	const tags: Record<string, string> = {};
	for (const part of value.split(";")) {
		const [name, ...rest] = part.split("=");
		if (!name?.trim() || !rest.length) continue;
		tags[name.trim().toLowerCase()] = rest.join("=").trim().toLowerCase();
	}
	return tags.v === "dmarc1" ? tags : null;
}

function invalid(code: string): never {
	throw Object.assign(new Error(code), { status: 422, code });
}
