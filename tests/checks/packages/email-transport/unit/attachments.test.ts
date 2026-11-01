import { describe, expect, it } from "vitest";

import {
	EMAIL_ATTACHMENTS_MAX_BYTES,
	buildMessage,
	normalizeAttachments,
	sanitizeContentType,
	sanitizeFilename,
} from "../../../../../packages/email-transport/src/index";

const config = {
	host: "smtp.example.test",
	port: 2525,
	security: "plain" as const,
	username: null,
	from_email: "sender@example.test",
	from_name: "SuperBoard",
	reply_to: null,
};
const pdf = btoa("%PDF-1.4 example");
const png = btoa("\x89PNG example");

describe("email attachments", () => {
	it("wraps the content in multipart/mixed with base64 attachment parts", () => {
		const { raw } = buildMessage(config, {
			to: "recipient@example.test",
			subject: "Invoice",
			text: "See attached",
			html: "<p>See attached</p>",
			attachments: [{ filename: "invoice.pdf", contentType: "application/pdf", content: pdf }],
		});
		expect(raw).toMatch(/Content-Type: multipart\/mixed; boundary="superboard-[^"]+-mixed"/);
		expect(raw).toContain("Content-Type: multipart/alternative;");
		expect(raw).toContain('Content-Type: application/pdf; name="invoice.pdf"');
		expect(raw).toContain('Content-Disposition: attachment; filename="invoice.pdf"');
		expect(raw).toContain("Content-Transfer-Encoding: base64");
		expect(raw).toContain(pdf);
	});

	it("nests inline images in multipart/related with their Content-ID", () => {
		const { raw } = buildMessage(config, {
			to: "recipient@example.test",
			subject: "Logo",
			text: null,
			html: '<img src="cid:logo@example.test">',
			attachments: [
				{
					filename: "logo.png",
					contentType: "image/png",
					content: png,
					disposition: "inline",
					contentId: "logo@example.test",
				},
			],
		});
		expect(raw).toMatch(/Content-Type: multipart\/related; boundary="[^"]+-related"/);
		expect(raw).not.toContain("multipart/mixed");
		expect(raw).toContain("Content-ID: <logo@example.test>");
		expect(raw).toContain("Content-Disposition: inline;");
	});

	it("wraps base64 lines at 76 characters", () => {
		const content = btoa("x".repeat(600));
		const { raw } = buildMessage(config, {
			to: "recipient@example.test",
			subject: "Long",
			text: "Body",
			html: null,
			attachments: [{ filename: "long.txt", contentType: "text/plain", content }],
		});
		const encoded = raw.split("\r\n").filter((line) => /^[A-Za-z0-9+/=]{20,}$/.test(line));
		expect(encoded.length).toBeGreaterThan(1);
		expect(Math.max(...encoded.map((line) => line.length))).toBeLessThanOrEqual(76);
	});

	it("neutralizes header injection and path traversal in filenames and types", () => {
		expect(sanitizeFilename('../../etc/passwd"\r\nBcc: victim@example.test')).toBe(
			"etc_passwd_Bcc_ victim@example.test",
		);
		expect(sanitizeFilename("")).toBe("attachment");
		expect(sanitizeContentType("text/html\r\nX-Injected: 1")).toBe("application/octet-stream");
		expect(sanitizeContentType("Application/PDF")).toBe("application/pdf");
		const { raw } = buildMessage(config, {
			to: "recipient@example.test",
			subject: "Unicode",
			text: "Body",
			html: null,
			attachments: [{ filename: "facture-été.pdf", contentType: "application/pdf", content: pdf }],
		});
		expect(raw).toContain("filename*=UTF-8''facture-%C3%A9t%C3%A9.pdf");
		expect(raw).not.toMatch(/\r\nBcc:/i);
	});

	it("rejects invalid base64, oversized totals and inline parts without Content-ID", () => {
		expect(() =>
			normalizeAttachments([{ filename: "a.txt", content: "not base64!" }]),
		).toThrowError(expect.objectContaining({ code: "email_attachment_content_invalid" }));
		const chunk = "AAAA".repeat(Math.ceil(EMAIL_ATTACHMENTS_MAX_BYTES / 2 / 3) + 4);
		expect(() =>
			normalizeAttachments([
				{ filename: "a.bin", content: chunk },
				{ filename: "b.bin", content: chunk },
			]),
		).toThrowError(expect.objectContaining({ code: "email_attachments_too_large" }));
		expect(() =>
			normalizeAttachments([{ filename: "a.png", content: png, disposition: "inline" }]),
		).toThrowError(expect.objectContaining({ code: "email_attachment_content_id_required" }));
	});

	it("keeps messages without attachments byte-compatible with the previous layout", () => {
		const { raw } = buildMessage(config, {
			to: "recipient@example.test",
			subject: "Plain",
			text: "Body",
			html: null,
		});
		expect(raw).toMatch(/MIME-Version: 1\.0\r\nContent-Type: text\/plain; charset=UTF-8\r\n/);
		expect(raw).not.toContain("multipart");
	});
});
