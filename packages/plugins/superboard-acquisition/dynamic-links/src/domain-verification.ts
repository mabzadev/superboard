type DomainVerificationRecord = { type: "TXT"; name: string; value: string };
type DomainVerificationResult = "verified" | "not_found" | "mismatch" | "lookup_failed";
type DomainVerificationCheck = {
	result: DomainVerificationResult;
	record: DomainVerificationRecord;
	found: string[];
};

const resolverUrl = "https://cloudflare-dns.com/dns-query";
const lookupTimeoutMs = 5_000;
const txtRecordType = 16;
const noError = 0;
const nonExistentDomain = 3;

/**
 * Ownership of a branded domain is proven by one TXT record:
 * name `_superboard.<hostname>`, value exactly the domain's verification token.
 */
export function domainVerificationRecord(
	hostname: string,
	token: string,
): DomainVerificationRecord {
	return { type: "TXT", name: `_superboard.${hostname}`, value: token };
}

export async function checkDomainVerification(
	record: DomainVerificationRecord,
	lookup: typeof fetch = fetch,
): Promise<DomainVerificationCheck> {
	const url = new URL(resolverUrl);
	url.searchParams.set("name", record.name);
	url.searchParams.set("type", record.type);
	let answer: unknown;
	try {
		const response = await lookup(url.toString(), {
			headers: { accept: "application/dns-json" },
			signal: AbortSignal.timeout(lookupTimeoutMs),
		});
		if (!response.ok) return { result: "lookup_failed", record, found: [] };
		answer = await response.json();
	} catch {
		return { result: "lookup_failed", record, found: [] };
	}
	const status = field(answer, "Status");
	if (status !== noError && status !== nonExistentDomain)
		return { result: "lookup_failed", record, found: [] };
	const answers = field(answer, "Answer");
	const found = (Array.isArray(answers) ? answers : [])
		.filter((item) => field(item, "type") === txtRecordType)
		.map((item) => field(item, "data"))
		.filter((data): data is string => typeof data === "string")
		.map(txtValue);
	if (found.includes(record.value)) return { result: "verified", record, found };
	return { result: found.length ? "mismatch" : "not_found", record, found };
}

function field(value: unknown, key: string): unknown {
	return value && typeof value === "object" ? Reflect.get(value, key) : undefined;
}

function txtValue(data: string) {
	const strings = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/gu)].map((match) =>
		(match[1] ?? "").replace(/\\(.)/gu, "$1"),
	);
	return (strings.length ? strings.join("") : data).trim();
}
