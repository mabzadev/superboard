import { describe, expect, it } from "vitest";

import {
	expectedDnsRecords,
	normalizeDomainAuthenticationConfig,
	suggestSpfRecord,
	verifyDomainAuthentication,
} from "../../../../../../packages/plugins/superboard-communication/email/src/sender-authentication.js";

type Zone = Record<string, { txt?: string[]; cname?: string[]; mx?: Array<[number, string]> }>;

describe("domain authentication wizard", () => {
	it("generates the exact Amazon SES records with Easy DKIM tokens and custom MAIL FROM", () => {
		const records = expectedDnsRecords({
			fromAddress: "hello@example.com",
			provider: "aws-ses",
			awsRegion: "eu-west-1",
			config: {
				dkim_tokens: ["abcdefghijklmnop1", "abcdefghijklmnop2"],
				mail_from_domain: "mail.example.com",
			},
		});
		expect(records).toEqual([
			{
				id: "mail_from_mx",
				purpose: "mail_from",
				type: "MX",
				host: "mail.example.com",
				priority: 10,
				value: "feedback-smtp.eu-west-1.amazonses.com",
			},
			{
				id: "spf",
				purpose: "spf",
				type: "TXT",
				host: "mail.example.com",
				value: "v=spf1 include:amazonses.com ~all",
			},
			{
				id: "dkim_1",
				purpose: "dkim",
				type: "CNAME",
				host: "abcdefghijklmnop1._domainkey.example.com",
				value: "abcdefghijklmnop1.dkim.amazonses.com",
			},
			{
				id: "dkim_2",
				purpose: "dkim",
				type: "CNAME",
				host: "abcdefghijklmnop2._domainkey.example.com",
				value: "abcdefghijklmnop2.dkim.amazonses.com",
			},
			{
				id: "dmarc",
				purpose: "dmarc",
				type: "TXT",
				host: "_dmarc.example.com",
				value: "v=DMARC1; p=none; rua=mailto:dmarc-reports@example.com",
			},
		]);
	});

	it("asks for the missing provider inputs of a custom SMTP sender", () => {
		const records = expectedDnsRecords({
			fromAddress: "hello@example.com",
			provider: "smtp",
			config: {},
		});
		expect(records.filter((record) => record.needs).map((record) => record.needs)).toEqual([
			"spf_include",
			"dkim",
		]);
		const configured = expectedDnsRecords({
			fromAddress: "hello@example.com",
			provider: "smtp",
			config: {
				spf_include: "_spf.mailer.net",
				dkim_selector: "s1",
				dkim_type: "txt",
				dkim_value: "v=DKIM1; k=rsa; p=ABC123",
				dmarc_rua: "reports@example.com",
			},
		});
		expect(configured.map(({ host, value }) => [host, value])).toEqual([
			["example.com", "v=spf1 include:_spf.mailer.net ~all"],
			["s1._domainkey.example.com", "v=DKIM1; k=rsa; p=ABC123"],
			["_dmarc.example.com", "v=DMARC1; p=none; rua=mailto:reports@example.com"],
		]);
	});

	it("verifies values and alignment, not only existence", async () => {
		const zone: Zone = {
			"example.com": { txt: ["v=spf1 include:_spf.google.com ~all"] },
			"s1._domainkey.example.com": { txt: ["v=DKIM1; k=rsa; p=OTHERKEY"] },
			"_dmarc.example.com": { txt: ["v=DMARC1; p=quarantine; rua=mailto:x@example.com"] },
		};
		const report = await verifyDomainAuthentication(
			{
				fromAddress: "hello@example.com",
				provider: "smtp",
				config: {
					spf_include: "_spf.mailer.net",
					dkim_selector: "s1",
					dkim_type: "txt",
					dkim_value: "v=DKIM1; k=rsa; p=ABC 123",
				},
			},
			resolver(zone),
		);
		const byId = Object.fromEntries(report.records.map((record) => [record.id, record]));
		expect(byId.spf).toMatchObject({
			status: "mismatch",
			value: "v=spf1 include:_spf.google.com include:_spf.mailer.net ~all",
		});
		expect(byId.dkim).toMatchObject({ status: "mismatch", aligned: true });
		expect(byId.dmarc).toMatchObject({ status: "verified" });
		expect(report).toMatchObject({
			spf: "mismatch",
			dkim: "mismatch",
			dmarc: "verified",
			ready: false,
		});

		zone["example.com"] = { txt: ["v=spf1 include:_spf.google.com include:_spf.mailer.net -all"] };
		zone["s1._domainkey.example.com"] = { txt: ["v=DKIM1; k=rsa; p=ABC123"] };
		const fixed = await verifyDomainAuthentication(
			{
				fromAddress: "hello@example.com",
				provider: "smtp",
				config: {
					spf_include: "_spf.mailer.net",
					dkim_selector: "s1",
					dkim_type: "txt",
					dkim_value: "v=DKIM1; k=rsa; p=ABC 123",
				},
			},
			resolver(zone),
		);
		expect(fixed).toMatchObject({
			spf: "verified",
			dkim: "verified",
			dmarc: "verified",
			alignment: { spf: true, dkim: true, dmarc_policy: "quarantine" },
			ready: true,
		});
	});

	it("checks SES CNAME targets, the MAIL FROM MX and rejects permissive or duplicate records", async () => {
		const zone: Zone = {
			"mail.example.com": {
				txt: ["v=spf1 include:amazonses.com ~all"],
				mx: [[10, "feedback-smtp.eu-west-1.amazonses.com"]],
			},
			"abcdefghijklmnop1._domainkey.example.com": {
				cname: ["abcdefghijklmnop1.dkim.amazonses.com"],
			},
			"_dmarc.example.com": { txt: ["v=DMARC1; p=none", "v=DMARC1; p=reject"] },
		};
		const input = {
			fromAddress: "hello@example.com",
			provider: "aws-ses" as const,
			awsRegion: "eu-west-1",
			config: { dkim_tokens: ["abcdefghijklmnop1"], mail_from_domain: "mail.example.com" },
		};
		const report = await verifyDomainAuthentication(input, resolver(zone));
		expect(report).toMatchObject({
			spf: "verified",
			dkim: "verified",
			dmarc: "mismatch",
			ready: false,
		});
		expect(report.alignment.spf).toBe(true);

		zone["_dmarc.example.com"] = { txt: ["v=DMARC1; p=none"] };
		zone["mail.example.com"]!.mx = [[10, "mx.other.net"]];
		const mx = await verifyDomainAuthentication(input, resolver(zone));
		expect(mx.records.find((record) => record.id === "mail_from_mx")).toMatchObject({
			status: "mismatch",
		});
		expect(mx.ready).toBe(false);

		const open = await verifyDomainAuthentication(
			{ fromAddress: "hello@example.com", provider: "smtp", config: { spf_include: "x.net" } },
			resolver({ "example.com": { txt: ["v=spf1 include:x.net +all"] } }),
		);
		expect(open.records.find((record) => record.id === "spf")).toMatchObject({
			status: "mismatch",
		});
	});

	it("validates wizard input and suggests merged SPF records", () => {
		expect(() =>
			normalizeDomainAuthenticationConfig({ mail_from_domain: "mail.other.com" }, "a@example.com"),
		).toThrowError(expect.objectContaining({ code: "mail_from_domain_invalid" }));
		expect(() =>
			normalizeDomainAuthenticationConfig({ dkim_tokens: "bad token!" }, "a@example.com"),
		).toThrowError(expect.objectContaining({ code: "dkim_tokens_invalid" }));
		expect(() =>
			normalizeDomainAuthenticationConfig(
				{ spf_include: "x.net\r\ninclude:evil" },
				"a@example.com",
			),
		).toThrowError(expect.objectContaining({ code: "authentication_config_invalid" }));
		expect(
			normalizeDomainAuthenticationConfig(
				{ dkim_tokens: "AAAAAAAAAAAAAAAA1, aaaaaaaaaaaaaaaa2" },
				"a@example.com",
			).dkim_tokens,
		).toEqual(["aaaaaaaaaaaaaaaa1", "aaaaaaaaaaaaaaaa2"]);
		expect(suggestSpfRecord("v=spf1 mx -all", "amazonses.com")).toBe(
			"v=spf1 mx include:amazonses.com -all",
		);
		expect(suggestSpfRecord("v=spf1 mx", "amazonses.com")).toBe(
			"v=spf1 mx include:amazonses.com ~all",
		);
	});
});

function resolver(zone: Zone): typeof fetch {
	return async (input: URL | RequestInfo) => {
		const url = new URL(input instanceof Request ? input.url : input);
		const query = Uint8Array.from(
			atob(url.searchParams.get("dns")!.replace(/-/g, "+").replace(/_/g, "/")),
			(c) => c.charCodeAt(0),
		);
		let offset = 12;
		const labels: string[] = [];
		while (query[offset]) {
			labels.push(
				new TextDecoder().decode(query.subarray(offset + 1, offset + 1 + query[offset]!)),
			);
			offset += 1 + query[offset]!;
		}
		const type = (query[offset + 1]! << 8) | query[offset + 2]!;
		const name = labels.join(".");
		const entry = zone[name] ?? {};
		const answers: Array<[number, Uint8Array]> = [];
		if (type === 16) for (const value of entry.txt ?? []) answers.push([16, txt(value)]);
		if (type === 5) for (const value of entry.cname ?? []) answers.push([5, encodeName(value)]);
		if (type === 15)
			for (const [priority, exchange] of entry.mx ?? [])
				answers.push([
					15,
					Uint8Array.from([priority >> 8, priority & 255, ...encodeName(exchange)]),
				]);
		const question = query.subarray(12, offset + 5);
		const parts: number[] = [0, 1, 0x81, 0x80, 0, 1, 0, answers.length, 0, 0, 0, 0, ...question];
		for (const [answerType, data] of answers)
			parts.push(
				0xc0,
				12,
				answerType >> 8,
				answerType & 255,
				0,
				1,
				0,
				0,
				1,
				44,
				data.length >> 8,
				data.length & 255,
				...data,
			);
		return new Response(Uint8Array.from(parts), {
			headers: { "content-type": "application/dns-message" },
		});
	};
}

function txt(value: string) {
	const bytes = new TextEncoder().encode(value);
	return Uint8Array.from([bytes.length, ...bytes]);
}

function encodeName(value: string) {
	const out: number[] = [];
	for (const label of value.split(".")) {
		const bytes = new TextEncoder().encode(label);
		out.push(bytes.length, ...bytes);
	}
	out.push(0);
	return Uint8Array.from(out);
}
