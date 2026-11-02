import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	cloudflareDohResolver,
	normalizeIPv6MappedToIPv4,
	resolveAndValidateExternalUrl,
	SsrfError,
	validateExternalUrl,
} from "../../../../../../packages/core/src/import/ssrf.js";

describe("validateExternalUrl", () => {
	it("accepts valid external URLs", () => {
		expect(validateExternalUrl("https://example.com")).toBeInstanceOf(URL);
		expect(validateExternalUrl("https://wordpress.org/feed")).toBeInstanceOf(URL);
		expect(validateExternalUrl("http://93.184.216.34/path")).toBeInstanceOf(URL);
	});

	it("rejects non-http schemes", () => {
		expect(() => validateExternalUrl("ftp://example.com")).toThrow(SsrfError);
		expect(() => validateExternalUrl("file:///etc/passwd")).toThrow(SsrfError);
		expect(() => validateExternalUrl("javascript:alert(1)")).toThrow(SsrfError);
	});

	it("rejects invalid URLs", () => {
		expect(() => validateExternalUrl("not a url")).toThrow(SsrfError);
		expect(() => validateExternalUrl("")).toThrow(SsrfError);
	});

	it("blocks localhost", () => {
		expect(() => validateExternalUrl("http://localhost/path")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://localhost:8080")).toThrow(SsrfError);
	});

	it("blocks metadata endpoints", () => {
		expect(() => validateExternalUrl("http://metadata.google.internal/")).toThrow(SsrfError);
	});

	it("blocks loopback (127.0.0.0/8)", () => {
		expect(() => validateExternalUrl("http://127.0.0.1/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://127.255.255.255/")).toThrow(SsrfError);
	});

	it("blocks private 10.0.0.0/8", () => {
		expect(() => validateExternalUrl("http://10.0.0.1/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://10.255.255.255/")).toThrow(SsrfError);
	});

	it("blocks private 172.16.0.0/12", () => {
		expect(() => validateExternalUrl("http://172.16.0.1/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://172.31.255.255/")).toThrow(SsrfError);
	});

	it("blocks private 192.168.0.0/16", () => {
		expect(() => validateExternalUrl("http://192.168.0.1/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://192.168.255.255/")).toThrow(SsrfError);
	});

	it("blocks link-local (169.254.0.0/16) including cloud metadata", () => {
		expect(() => validateExternalUrl("http://169.254.169.254/latest/meta-data/")).toThrow(
			SsrfError,
		);
		expect(() => validateExternalUrl("http://169.254.0.1/")).toThrow(SsrfError);
	});

	it("blocks IPv6 loopback [::1]", () => {
		expect(() => validateExternalUrl("http://[::1]/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://[::1]:8080/")).toThrow(SsrfError);
	});

	it("blocks IPv4-mapped IPv6 loopback in hex form [::ffff:7f00:1]", () => {
		expect(() => validateExternalUrl("http://[::ffff:7f00:1]/evil")).toThrow(SsrfError);
	});

	it("blocks IPv4-mapped IPv6 cloud metadata [::ffff:a9fe:a9fe]", () => {
		expect(() => validateExternalUrl("http://[::ffff:a9fe:a9fe]/latest/meta-data/")).toThrow(
			SsrfError,
		);
	});

	it("blocks IPv4-mapped IPv6 private 10.x [::ffff:a00:1]", () => {
		expect(() => validateExternalUrl("http://[::ffff:a00:1]/")).toThrow(SsrfError);
	});

	it("blocks IPv4-mapped IPv6 private 192.168.x [::ffff:c0a8:1]", () => {
		expect(() => validateExternalUrl("http://[::ffff:c0a8:1]/")).toThrow(SsrfError);
	});

	it("blocks IPv4-mapped IPv6 private 172.16.x [::ffff:ac10:1]", () => {
		expect(() => validateExternalUrl("http://[::ffff:ac10:1]/")).toThrow(SsrfError);
	});

	it("blocks IPv4-mapped IPv6 in dotted-decimal form", () => {
		expect(() => validateExternalUrl("http://[::ffff:127.0.0.1]/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://[::ffff:169.254.169.254]/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://[::ffff:10.0.0.1]/")).toThrow(SsrfError);
	});

	it("allows IPv4-mapped IPv6 for public IPs", () => {
		expect(validateExternalUrl("http://[::ffff:5db8:d822]/")).toBeInstanceOf(URL);
	});

	it("blocks IPv4-compatible loopback [::7f00:1]", () => {
		expect(() => validateExternalUrl("http://[::7f00:1]/evil")).toThrow(SsrfError);
	});

	it("blocks IPv4-compatible cloud metadata [::a9fe:a9fe]", () => {
		expect(() => validateExternalUrl("http://[::a9fe:a9fe]/latest/meta-data/")).toThrow(SsrfError);
	});

	it("blocks IPv4-compatible private 10.x [::a00:1]", () => {
		expect(() => validateExternalUrl("http://[::a00:1]/")).toThrow(SsrfError);
	});

	it("blocks IPv4-compatible private 192.168.x [::c0a8:1]", () => {
		expect(() => validateExternalUrl("http://[::c0a8:1]/")).toThrow(SsrfError);
	});

	it("allows IPv4-compatible public IPs [::5db8:d822]", () => {
		expect(validateExternalUrl("http://[::5db8:d822]/")).toBeInstanceOf(URL);
	});

	it("blocks NAT64 loopback [64:ff9b::7f00:1]", () => {
		expect(() => validateExternalUrl("http://[64:ff9b::7f00:1]/evil")).toThrow(SsrfError);
	});

	it("blocks NAT64 cloud metadata [64:ff9b::a9fe:a9fe]", () => {
		expect(() => validateExternalUrl("http://[64:ff9b::a9fe:a9fe]/latest/meta-data/")).toThrow(
			SsrfError,
		);
	});

	it("blocks NAT64 private 10.x [64:ff9b::a00:1]", () => {
		expect(() => validateExternalUrl("http://[64:ff9b::a00:1]/")).toThrow(SsrfError);
	});

	it("blocks NAT64 private 192.168.x [64:ff9b::c0a8:1]", () => {
		expect(() => validateExternalUrl("http://[64:ff9b::c0a8:1]/")).toThrow(SsrfError);
	});

	it("allows NAT64 public IPs [64:ff9b::5db8:d822]", () => {
		expect(validateExternalUrl("http://[64:ff9b::5db8:d822]/")).toBeInstanceOf(URL);
	});

	it("blocks IPv6 link-local (fe80::)", () => {
		expect(() => validateExternalUrl("http://[fe80::1]/")).toThrow(SsrfError);
	});

	it("blocks IPv6 unique local (fc00::/fd00::)", () => {
		expect(() => validateExternalUrl("http://[fc00::1]/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://[fd00::1]/")).toThrow(SsrfError);
	});

	it("blocks 0.0.0.0/8 range", () => {
		expect(() => validateExternalUrl("http://0.0.0.0/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://0.0.0.1/")).toThrow(SsrfError);
	});

	it("blocks IPv4 literals with trailing dots", () => {
		expect(() => validateExternalUrl("http://127.0.0.1./")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://127.0.0.1../")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://169.254.169.254../")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://10.0.0.1../")).toThrow(SsrfError);
	});
});

describe("normalizeIPv6MappedToIPv4", () => {
	it("converts loopback ::ffff:7f00:1 -> 127.0.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:7f00:1")).toBe("127.0.0.1");
	});

	it("converts cloud metadata ::ffff:a9fe:a9fe -> 169.254.169.254", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:a9fe:a9fe")).toBe("169.254.169.254");
	});

	it("converts private 10.x ::ffff:a00:1 -> 10.0.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:a00:1")).toBe("10.0.0.1");
	});

	it("converts private 192.168.x ::ffff:c0a8:1 -> 192.168.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:c0a8:1")).toBe("192.168.0.1");
	});

	it("converts private 172.16.x ::ffff:ac10:1 -> 172.16.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:ac10:1")).toBe("172.16.0.1");
	});

	it("converts public IP ::ffff:5db8:d822 -> 93.184.216.34", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:5db8:d822")).toBe("93.184.216.34");
	});

	it("converts ::ffff:0:0 -> 0.0.0.0", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:0:0")).toBe("0.0.0.0");
	});

	it("converts ::ffff:ffff:ffff -> 255.255.255.255", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:ffff:ffff")).toBe("255.255.255.255");
	});

	it("converts 4-digit hex groups correctly ::ffff:c612:e3a -> 198.18.14.58", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:c612:e3a")).toBe("198.18.14.58");
	});

	it("handles uppercase hex digits", () => {
		expect(normalizeIPv6MappedToIPv4("::FFFF:7F00:1")).toBe("127.0.0.1");
	});

	it("handles mixed case hex digits", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:A9FE:a9fe")).toBe("169.254.169.254");
	});

	it("returns null for bracketed input (brackets stripped by caller)", () => {
		expect(normalizeIPv6MappedToIPv4("[::ffff:7f00:1]")).toBeNull();
		expect(normalizeIPv6MappedToIPv4("[::ffff:a9fe:a9fe]")).toBeNull();
	});

	it("converts translated form ::ffff:0:7f00:1 -> 127.0.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:0:7f00:1")).toBe("127.0.0.1");
	});

	it("converts translated form ::ffff:0:a9fe:a9fe -> 169.254.169.254", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:0:a9fe:a9fe")).toBe("169.254.169.254");
	});

	it("converts expanded form 0:0:0:0:0:ffff:7f00:1 -> 127.0.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("0:0:0:0:0:ffff:7f00:1")).toBe("127.0.0.1");
	});

	it("converts expanded form 0000:0000:0000:0000:0000:ffff:a9fe:a9fe -> 169.254.169.254", () => {
		expect(normalizeIPv6MappedToIPv4("0000:0000:0000:0000:0000:ffff:a9fe:a9fe")).toBe(
			"169.254.169.254",
		);
	});

	it("converts expanded form with mixed zero lengths", () => {
		expect(normalizeIPv6MappedToIPv4("0:00:000:0000:0:ffff:a00:1")).toBe("10.0.0.1");
	});

	it("converts IPv4-compatible loopback ::7f00:1 -> 127.0.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("::7f00:1")).toBe("127.0.0.1");
	});

	it("converts IPv4-compatible metadata ::a9fe:a9fe -> 169.254.169.254", () => {
		expect(normalizeIPv6MappedToIPv4("::a9fe:a9fe")).toBe("169.254.169.254");
	});

	it("converts IPv4-compatible private ::a00:1 -> 10.0.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("::a00:1")).toBe("10.0.0.1");
	});

	it("converts IPv4-compatible public ::5db8:d822 -> 93.184.216.34", () => {
		expect(normalizeIPv6MappedToIPv4("::5db8:d822")).toBe("93.184.216.34");
	});

	it("converts NAT64 loopback 64:ff9b::7f00:1 -> 127.0.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("64:ff9b::7f00:1")).toBe("127.0.0.1");
	});

	it("converts NAT64 metadata 64:ff9b::a9fe:a9fe -> 169.254.169.254", () => {
		expect(normalizeIPv6MappedToIPv4("64:ff9b::a9fe:a9fe")).toBe("169.254.169.254");
	});

	it("converts NAT64 private 64:ff9b::a00:1 -> 10.0.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("64:ff9b::a00:1")).toBe("10.0.0.1");
	});

	it("converts NAT64 public 64:ff9b::5db8:d822 -> 93.184.216.34", () => {
		expect(normalizeIPv6MappedToIPv4("64:ff9b::5db8:d822")).toBe("93.184.216.34");
	});

	it("returns null for plain IPv4", () => {
		expect(normalizeIPv6MappedToIPv4("127.0.0.1")).toBeNull();
	});

	it("returns null for IPv6 loopback ::1", () => {
		expect(normalizeIPv6MappedToIPv4("::1")).toBeNull();
	});

	it("returns null for regular IPv6 address", () => {
		expect(normalizeIPv6MappedToIPv4("2001:db8::1")).toBeNull();
	});

	it("returns null for link-local IPv6", () => {
		expect(normalizeIPv6MappedToIPv4("fe80::1")).toBeNull();
	});

	it("returns null for hostnames", () => {
		expect(normalizeIPv6MappedToIPv4("example.com")).toBeNull();
		expect(normalizeIPv6MappedToIPv4("localhost")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(normalizeIPv6MappedToIPv4("")).toBeNull();
	});

	it("returns null for dotted-decimal mapped form (handled separately)", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:127.0.0.1")).toBeNull();
	});
});

describe("validateExternalUrl — wildcard DNS rebinding services", () => {
	it("blocks nip.io and its subdomains", () => {
		expect(() => validateExternalUrl("http://nip.io/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://127.0.0.1.nip.io/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://169.254.169.254.nip.io/latest/")).toThrow(SsrfError);
	});

	it("blocks sslip.io and its subdomains", () => {
		expect(() => validateExternalUrl("http://sslip.io/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://127.0.0.1.sslip.io/")).toThrow(SsrfError);
	});

	it("blocks xip.io and its subdomains", () => {
		expect(() => validateExternalUrl("http://xip.io/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://10.0.0.1.xip.io/")).toThrow(SsrfError);
	});

	it("blocks traefik.me and its subdomains", () => {
		expect(() => validateExternalUrl("http://traefik.me/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://127.0.0.1.traefik.me/")).toThrow(SsrfError);
	});

	it("is case-insensitive for blocklisted hostnames", () => {
		expect(() => validateExternalUrl("http://NIP.IO/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://127.0.0.1.Nip.Io/")).toThrow(SsrfError);
	});

	it("blocks trailing-dot FQDNs on the hostname blocklist", () => {
		expect(() => validateExternalUrl("http://localhost./")).toThrow(SsrfError);
	});

	it("blocks trailing-dot FQDNs on the wildcard suffix list", () => {
		expect(() => validateExternalUrl("http://nip.io./")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://127.0.0.1.nip.io./")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://sslip.io./")).toThrow(SsrfError);
	});

	it("allows look-alike domains that are not on the blocklist", () => {
		expect(validateExternalUrl("http://nippon.example.com/")).toBeInstanceOf(URL);
	});
});

describe("resolveAndValidateExternalUrl", () => {
	function resolver(ips: string[]): (host: string) => Promise<string[]> {
		return async () => ips;
	}

	function failingResolver(error = new Error("DNS failure")) {
		return async () => {
			throw error;
		};
	}

	it("accepts public IPs", async () => {
		const url = await resolveAndValidateExternalUrl("https://example.com/", {
			resolver: resolver(["93.184.216.34"]),
		});
		expect(url).toBeInstanceOf(URL);
		expect(url.hostname).toBe("example.com");
	});

	it("rejects hostnames that resolve to loopback", async () => {
		await expect(
			resolveAndValidateExternalUrl("https://attacker.example/", {
				resolver: resolver(["127.0.0.1"]),
			}),
		).rejects.toThrow(SsrfError);
	});

	it("rejects hostnames that resolve to cloud metadata IP", async () => {
		await expect(
			resolveAndValidateExternalUrl("https://attacker.example/", {
				resolver: resolver(["169.254.169.254"]),
			}),
		).rejects.toThrow(SsrfError);
	});

	it("rejects hostnames that resolve to any RFC1918 address", async () => {
		for (const ip of ["10.0.0.1", "172.16.0.1", "192.168.1.1"]) {
			await expect(
				resolveAndValidateExternalUrl("https://attacker.example/", {
					resolver: resolver([ip]),
				}),
			).rejects.toThrow(SsrfError);
		}
	});

	it("rejects if ANY resolved IP is private (multi-record DNS rebinding)", async () => {
		await expect(
			resolveAndValidateExternalUrl("https://attacker.example/", {
				resolver: resolver(["93.184.216.34", "127.0.0.1"]),
			}),
		).rejects.toThrow(SsrfError);
	});

	it("rejects IPv6 loopback in resolved records", async () => {
		await expect(
			resolveAndValidateExternalUrl("https://attacker.example/", {
				resolver: resolver(["::1"]),
			}),
		).rejects.toThrow(SsrfError);
	});

	it("rejects IPv6 link-local in resolved records (any case)", async () => {
		for (const ip of ["fe80::1", "FE80::1", "Fe80::abcd"]) {
			await expect(
				resolveAndValidateExternalUrl("https://attacker.example/", {
					resolver: resolver([ip]),
				}),
			).rejects.toThrow(SsrfError);
		}
	});

	it("rejects IPv6 unique-local in resolved records (any case)", async () => {
		for (const ip of ["fc00::1", "FC00::1", "fd12:3456::1", "FD00::BEEF"]) {
			await expect(
				resolveAndValidateExternalUrl("https://attacker.example/", {
					resolver: resolver([ip]),
				}),
			).rejects.toThrow(SsrfError);
		}
	});

	it("rejects IPv4-mapped IPv6 loopback in resolved records", async () => {
		await expect(
			resolveAndValidateExternalUrl("https://attacker.example/", {
				resolver: resolver(["::ffff:127.0.0.1"]),
			}),
		).rejects.toThrow(SsrfError);
	});

	it("accepts public IPv6 addresses", async () => {
		const url = await resolveAndValidateExternalUrl("https://example.com/", {
			resolver: resolver(["2606:4700:4700::1111"]),
		});
		expect(url).toBeInstanceOf(URL);
	});

	it("runs synchronous validateExternalUrl first (short-circuits on literal IP)", async () => {
		const r = failingResolver(new Error("should not be called"));
		await expect(
			resolveAndValidateExternalUrl("http://127.0.0.1/", { resolver: r }),
		).rejects.toThrow(SsrfError);
	});

	it("fails closed when the resolver throws", async () => {
		await expect(
			resolveAndValidateExternalUrl("https://example.com/", {
				resolver: failingResolver(),
			}),
		).rejects.toThrow(SsrfError);
	});

	it("rejects empty resolver result (hostname resolves to nothing)", async () => {
		await expect(
			resolveAndValidateExternalUrl("https://example.com/", {
				resolver: resolver([]),
			}),
		).rejects.toThrow(SsrfError);
	});

	it("returns the parsed URL on success", async () => {
		const url = await resolveAndValidateExternalUrl("https://example.com/path?q=1", {
			resolver: resolver(["93.184.216.34"]),
		});
		expect(url.pathname).toBe("/path");
		expect(url.searchParams.get("q")).toBe("1");
	});
});

describe("cloudflareDohResolver", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function stubFetch(
		responses: Record<"A" | "AAAA", { body?: unknown; status?: number; throws?: Error }>,
	): void {
		globalThis.fetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const type: "A" | "AAAA" = url.includes("type=AAAA") ? "AAAA" : "A";
			const res = responses[type];
			if (res.throws) throw res.throws;
			return new Response(JSON.stringify(res.body ?? {}), { status: res.status ?? 200 });
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal stub
		}) as unknown as typeof globalThis.fetch;
	}

	it("returns A and AAAA records from a valid Status=0 response", async () => {
		stubFetch({
			A: { body: { Status: 0, Answer: [{ data: "93.184.216.34" }] } },
			AAAA: { body: { Status: 0, Answer: [{ data: "2606:4700::1" }] } },
		});

		const ips = await cloudflareDohResolver("example.com");
		expect(ips).toContain("93.184.216.34");
		expect(ips).toContain("2606:4700::1");
	});

	it("treats NXDOMAIN (Status=3) as empty (legitimately no records)", async () => {
		stubFetch({
			A: { body: { Status: 3 } },
			AAAA: { body: { Status: 3 } },
		});
		const ips = await cloudflareDohResolver("does-not-exist.example");
		expect(ips).toEqual([]);
	});

	it("fails closed on SERVFAIL (Status=2)", async () => {
		stubFetch({
			A: { body: { Status: 2 } },
			AAAA: { body: { Status: 0, Answer: [{ data: "2606:4700::1" }] } },
		});
		await expect(cloudflareDohResolver("attacker.example")).rejects.toThrow();
	});

	it("fails closed on REFUSED (Status=5)", async () => {
		stubFetch({
			A: { body: { Status: 5 } },
			AAAA: { body: { Status: 0, Answer: [{ data: "2606:4700::1" }] } },
		});
		await expect(cloudflareDohResolver("attacker.example")).rejects.toThrow();
	});

	it("fails closed on HTTP errors from the DoH endpoint", async () => {
		stubFetch({
			A: { status: 500 },
			AAAA: { body: { Status: 0, Answer: [] } },
		});
		await expect(cloudflareDohResolver("example.com")).rejects.toThrow();
	});

	it("fails closed on malformed response bodies missing Status", async () => {
		stubFetch({
			A: { body: {} },
			AAAA: { body: { Status: 0, Answer: [] } },
		});
		await expect(cloudflareDohResolver("example.com")).rejects.toThrow();
	});

	it("fails closed on network errors", async () => {
		stubFetch({
			A: { throws: new Error("network down") },
			AAAA: { body: { Status: 0, Answer: [] } },
		});
		await expect(cloudflareDohResolver("example.com")).rejects.toThrow();
	});

	it("returns empty array when both A and AAAA return no records but Status=0", async () => {
		stubFetch({
			A: { body: { Status: 0, Answer: [] } },
			AAAA: { body: { Status: 0, Answer: [] } },
		});
		const ips = await cloudflareDohResolver("example.com");
		expect(ips).toEqual([]);
	});

	it("skips Answer entries without string data", async () => {
		stubFetch({
			A: {
				body: {
					Status: 0,
					Answer: [{ data: "93.184.216.34" }, { data: 12345 }, {}, { notData: "foo" }],
				},
			},
			AAAA: { body: { Status: 0, Answer: [] } },
		});
		const ips = await cloudflareDohResolver("example.com");
		expect(ips).toEqual(["93.184.216.34"]);
	});

	it("filters CNAME-style hostname answers, keeping only IP literals", async () => {
		stubFetch({
			A: {
				body: {
					Status: 0,
					Answer: [{ data: "cdn.example.com." }, { data: "93.184.216.34" }],
				},
			},
			AAAA: {
				body: {
					Status: 0,
					Answer: [{ data: "other.example.com." }, { data: "2606:4700::1" }],
				},
			},
		});
		const ips = await cloudflareDohResolver("example.com");
		expect(ips).toEqual(["93.184.216.34", "2606:4700::1"]);
	});

	it("rejects a response that contains only CNAME strings", async () => {
		stubFetch({
			A: {
				body: {
					Status: 0,
					Answer: [{ data: "target.example.com." }],
				},
			},
			AAAA: { body: { Status: 0, Answer: [] } },
		});
		const ips = await cloudflareDohResolver("cname-only.example");
		expect(ips).toEqual([]);
	});
});
