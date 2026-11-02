import { describe, expect, it } from "vitest";

import { validatePublishUrlForTest as validate } from "../../../../packages/plugin-cli/src/commands/publish.js";

describe("validatePublishUrl", () => {
	describe("rejects non-public IPv4 literals", () => {
		it.each([
			"https://127.0.0.1/x",
			"https://10.0.0.1/x",
			"https://192.168.1.1/x",
			"https://172.16.0.1/x",
			"https://172.31.255.255/x",
			"https://169.254.169.254/x",
			"https://0.0.0.0/x",
			"https://100.64.0.1/x",
		])("blocks %s", (url) => {
			expect(validate(url)).not.toBeNull();
		});

		it.each(["https://172.15.0.1/x", "https://172.32.0.1/x"])(
			"allows %s (just outside private range)",
			(url) => {
				expect(validate(url)).toBeNull();
			},
		);
	});

	describe("rejects non-public IPv6 literals", () => {
		it.each([
			"https://[::1]/x",
			"https://[fc00::1]/x",
			"https://[fd00::1]/x",
			"https://[fe80::1]/x",
			"https://[::ffff:169.254.169.254]/x",
			"https://[::ffff:127.0.0.1]/x",
			"https://[::ffff:10.0.0.1]/x",
			"https://[::169.254.169.254]/x",
			"https://[64:ff9b::169.254.169.254]/x",
		])("blocks %s", (url) => {
			expect(validate(url)).not.toBeNull();
		});

		it.each(["https://[2001:db8::1]/x", "https://[2606:4700::1]/x"])("allows %s", (url) => {
			expect(validate(url)).toBeNull();
		});
	});

	it("rejects localhost / .local hostnames", () => {
		expect(validate("https://localhost/x")).not.toBeNull();
		expect(validate("https://my-machine.local/x")).not.toBeNull();
	});

	it("rejects FQDN trailing-dot variants of denied hostnames", () => {
		expect(validate("https://localhost./x")).not.toBeNull();
		expect(validate("https://my-machine.local./x")).not.toBeNull();
	});

	it("does not over-block public IPv6 with private-looking suffix", () => {
		expect(validate("https://[2001:db8::a00:1]/x")).toBeNull();
	});

	it("rejects 6to4 with embedded private v4", () => {
		expect(validate("https://[2002:a00:1::1]/x")).not.toBeNull();
	});

	it("rejects RFC 8215 local-use NAT64 prefix with embedded private v4", () => {
		expect(validate("https://[64:ff9b:1:0:0:0:a9fe:a9fe]/x")).not.toBeNull();
	});

	it("rejects http://", () => {
		expect(validate("http://example.com/x")).not.toBeNull();
	});

	it("rejects file://, ftp://", () => {
		expect(validate("file:///etc/passwd")).not.toBeNull();
		expect(validate("ftp://example.com/x")).not.toBeNull();
	});

	it("rejects malformed URLs", () => {
		expect(validate("not a url")).not.toBeNull();
		expect(validate("")).not.toBeNull();
	});

	it("allows ordinary public https URLs", () => {
		expect(validate("https://example.com/file.tar.gz")).toBeNull();
		expect(validate("https://github.com/owner/repo/releases/download/v1/x.tar.gz")).toBeNull();
		expect(validate("https://cdn.example.com:8443/path?query=1#frag")).toBeNull();
	});
});
