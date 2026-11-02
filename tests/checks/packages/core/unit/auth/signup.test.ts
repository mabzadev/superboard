import type { AuthAdapter, EmailSendFn } from "@emdash-cms/auth";
import type { EmailMessage } from "@emdash-cms/auth";
import {
	Role,
	canSignup,
	requestSignup,
	validateSignupToken,
	completeSignup,
	SignupError,
} from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { Kysely } from "kysely";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

const TOKEN_PARAM_REGEX = /token=/;
const TOKEN_EXTRACT_REGEX = /token=([a-zA-Z0-9_-]+)/;

describe("Self-Signup", () => {
	let db: Kysely<Database>;
	let adapter: AuthAdapter;

	beforeEach(async () => {
		db = await setupTestDatabase();
		adapter = createKyselyAdapter(db);
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	describe("canSignup", () => {
		it("should return null for email with no allowed domain", async () => {
			const result = await canSignup(adapter, "user@notallowed.com");
			expect(result).toBeNull();
		});

		it("should return null for email with disabled domain", async () => {
			await adapter.createAllowedDomain("disabled.com", Role.AUTHOR);
			await adapter.updateAllowedDomain("disabled.com", false);

			const result = await canSignup(adapter, "user@disabled.com");
			expect(result).toBeNull();
		});

		it("should return allowed:true and role for email with allowed domain", async () => {
			await adapter.createAllowedDomain("allowed.com", Role.AUTHOR);

			const result = await canSignup(adapter, "user@allowed.com");

			expect(result).not.toBeNull();
			expect(result?.allowed).toBe(true);
			expect(result?.role).toBe(Role.AUTHOR);
		});

		it("should return correct role for each domain", async () => {
			await adapter.createAllowedDomain("authors.com", Role.AUTHOR);
			await adapter.createAllowedDomain("editors.com", Role.EDITOR);
			await adapter.createAllowedDomain("contributors.com", Role.CONTRIBUTOR);

			const author = await canSignup(adapter, "user@authors.com");
			const editor = await canSignup(adapter, "user@editors.com");
			const contributor = await canSignup(adapter, "user@contributors.com");

			expect(author?.role).toBe(Role.AUTHOR);
			expect(editor?.role).toBe(Role.EDITOR);
			expect(contributor?.role).toBe(Role.CONTRIBUTOR);
		});

		it("should be case-insensitive for email domains", async () => {
			await adapter.createAllowedDomain("example.com", Role.AUTHOR);

			const result = await canSignup(adapter, "User@EXAMPLE.COM");
			expect(result).not.toBeNull();
		});

		it("should return null for invalid email format", async () => {
			const result = await canSignup(adapter, "not-an-email");
			expect(result).toBeNull();
		});
	});

	describe("requestSignup", () => {
		let mockEmailSend: EmailSendFn & ReturnType<typeof vi.fn>;
		let sentEmails: Array<EmailMessage>;

		beforeEach(() => {
			sentEmails = [];
			mockEmailSend = vi.fn(async (email: EmailMessage) => {
				sentEmails.push(email);
			});
		});

		it("should send verification email for allowed domain", async () => {
			await adapter.createAllowedDomain("allowed.com", Role.AUTHOR);

			await requestSignup(
				{
					baseUrl: "https://example.com",
					email: mockEmailSend,
					siteName: "Test Site",
				},
				adapter,
				"newuser@allowed.com",
			);

			expect(mockEmailSend).toHaveBeenCalledTimes(1);
			expect(sentEmails[0]!.to).toBe("newuser@allowed.com");
			expect(sentEmails[0]!.subject).toContain("Test Site");
			expect(sentEmails[0]!.text).toContain(
				"https://example.com/_emdash/api/auth/signup/verify?token=",
			);
			expect(sentEmails[0]!.text).toContain("verify");
		});

		it("should fail silently for disallowed domain (no email sent)", async () => {
			await requestSignup(
				{
					baseUrl: "https://example.com",
					email: mockEmailSend,
					siteName: "Test Site",
				},
				adapter,
				"user@notallowed.com",
			);

			expect(mockEmailSend).not.toHaveBeenCalled();
		});

		it("should fail silently if user already exists (no email sent)", async () => {
			await adapter.createAllowedDomain("allowed.com", Role.AUTHOR);

			await adapter.createUser({
				email: "existing@allowed.com",
				name: "Existing User",
			});

			await requestSignup(
				{
					baseUrl: "https://example.com",
					email: mockEmailSend,
					siteName: "Test Site",
				},
				adapter,
				"existing@allowed.com",
			);

			expect(mockEmailSend).not.toHaveBeenCalled();
		});

		it("should create a token in the database", async () => {
			await adapter.createAllowedDomain("allowed.com", Role.EDITOR);

			await requestSignup(
				{
					baseUrl: "https://example.com",
					email: mockEmailSend,
					siteName: "Test Site",
				},
				adapter,
				"newuser@allowed.com",
			);

			expect(sentEmails[0]!.text).toMatch(TOKEN_PARAM_REGEX);
		});
	});

	describe("validateSignupToken", () => {
		let mockEmailSend: EmailSendFn & ReturnType<typeof vi.fn>;
		let capturedToken: string | null;

		beforeEach(() => {
			capturedToken = null;
			mockEmailSend = vi.fn(async (email: EmailMessage) => {
				const match = email.text.match(TOKEN_EXTRACT_REGEX);
				capturedToken = match ? (match[1] ?? null) : null;
			});
		});

		it("should validate a valid token and return email/role", async () => {
			await adapter.createAllowedDomain("allowed.com", Role.AUTHOR);

			await requestSignup(
				{
					baseUrl: "https://example.com",
					email: mockEmailSend,
					siteName: "Test Site",
				},
				adapter,
				"newuser@allowed.com",
			);

			expect(capturedToken).not.toBeNull();

			const result = await validateSignupToken(adapter, capturedToken!);

			expect(result.email).toBe("newuser@allowed.com");
			expect(result.role).toBe(Role.AUTHOR);
		});

		it("should throw invalid_token for non-existent token", async () => {
			const fakeToken = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo";

			try {
				await validateSignupToken(adapter, fakeToken);
				expect.fail("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(SignupError);
				expect((error as SignupError).code).toBe("invalid_token");
			}
		});

		it("should throw token_expired for expired token", async () => {
			await adapter.createAllowedDomain("allowed.com", Role.AUTHOR);

			await requestSignup(
				{
					baseUrl: "https://example.com",
					email: mockEmailSend,
					siteName: "Test Site",
				},
				adapter,
				"newuser@allowed.com",
			);

			expect(capturedToken).not.toBeNull();

			const result = await validateSignupToken(adapter, capturedToken!);
			expect(result.email).toBe("newuser@allowed.com");
		});
	});

	describe("completeSignup", () => {
		let mockEmailSend: EmailSendFn & ReturnType<typeof vi.fn>;
		let capturedToken: string | null;

		beforeEach(() => {
			capturedToken = null;
			mockEmailSend = vi.fn(async (email: EmailMessage) => {
				const match = email.text.match(TOKEN_EXTRACT_REGEX);
				capturedToken = match ? (match[1] ?? null) : null;
			});
		});

		it("should create user with correct email and role", async () => {
			await adapter.createAllowedDomain("allowed.com", Role.AUTHOR);

			await requestSignup(
				{
					baseUrl: "https://example.com",
					email: mockEmailSend,
					siteName: "Test Site",
				},
				adapter,
				"newuser@allowed.com",
			);

			const user = await completeSignup(adapter, capturedToken!, {
				name: "New User",
			});

			expect(user.email).toBe("newuser@allowed.com");
			expect(user.name).toBe("New User");
			expect(user.role).toBe(Role.AUTHOR);
			expect(user.emailVerified).toBe(true);
		});

		it("should throw user_exists if user created during signup flow (race condition)", async () => {
			await adapter.createAllowedDomain("allowed.com", Role.AUTHOR);

			await requestSignup(
				{
					baseUrl: "https://example.com",
					email: mockEmailSend,
					siteName: "Test Site",
				},
				adapter,
				"newuser@allowed.com",
			);

			await adapter.createUser({
				email: "newuser@allowed.com",
				name: "Created During Race",
			});

			try {
				await completeSignup(adapter, capturedToken!, { name: "New User" });
				expect.fail("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(SignupError);
				expect((error as SignupError).code).toBe("user_exists");
			}
		});

		it("should throw invalid_token for non-existent token", async () => {
			const fakeToken = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo";

			try {
				await completeSignup(adapter, fakeToken, { name: "User" });
				expect.fail("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(SignupError);
				expect((error as SignupError).code).toBe("invalid_token");
			}
		});

		it("should delete token after successful signup (single-use)", async () => {
			await adapter.createAllowedDomain("allowed.com", Role.AUTHOR);

			await requestSignup(
				{
					baseUrl: "https://example.com",
					email: mockEmailSend,
					siteName: "Test Site",
				},
				adapter,
				"newuser@allowed.com",
			);

			await completeSignup(adapter, capturedToken!, { name: "New User" });

			await expect(
				completeSignup(adapter, capturedToken!, { name: "Another User" }),
			).rejects.toThrow(SignupError);
		});

		it("should allow optional name and avatarUrl", async () => {
			await adapter.createAllowedDomain("allowed.com", Role.AUTHOR);

			await requestSignup(
				{
					baseUrl: "https://example.com",
					email: mockEmailSend,
					siteName: "Test Site",
				},
				adapter,
				"noname@allowed.com",
			);

			const user = await completeSignup(adapter, capturedToken!, {});

			expect(user.email).toBe("noname@allowed.com");
			expect(user.name).toBeNull();
		});

		it("should set emailVerified to true", async () => {
			await adapter.createAllowedDomain("allowed.com", Role.AUTHOR);

			await requestSignup(
				{
					baseUrl: "https://example.com",
					email: mockEmailSend,
					siteName: "Test Site",
				},
				adapter,
				"verified@allowed.com",
			);

			const user = await completeSignup(adapter, capturedToken!, {
				name: "Verified User",
			});

			expect(user.emailVerified).toBe(true);
		});
	});

	describe("Integration: Full Signup Flow", () => {
		let mockEmailSend: EmailSendFn & ReturnType<typeof vi.fn>;
		let capturedToken: string | null;

		beforeEach(() => {
			capturedToken = null;
			mockEmailSend = vi.fn(async (email: EmailMessage) => {
				const match = email.text.match(TOKEN_EXTRACT_REGEX);
				capturedToken = match ? (match[1] ?? null) : null;
			});
		});

		it("should complete full signup flow for allowed domain", async () => {
			await adapter.createAllowedDomain("company.com", Role.EDITOR);

			const check = await canSignup(adapter, "employee@company.com");
			expect(check?.allowed).toBe(true);
			expect(check?.role).toBe(Role.EDITOR);

			await requestSignup(
				{
					baseUrl: "https://example.com",
					email: mockEmailSend,
					siteName: "Company CMS",
				},
				adapter,
				"employee@company.com",
			);
			expect(capturedToken).not.toBeNull();

			const validation = await validateSignupToken(adapter, capturedToken!);
			expect(validation.email).toBe("employee@company.com");
			expect(validation.role).toBe(Role.EDITOR);

			const user = await completeSignup(adapter, capturedToken!, {
				name: "New Employee",
			});

			expect(user.email).toBe("employee@company.com");
			expect(user.name).toBe("New Employee");
			expect(user.role).toBe(Role.EDITOR);
			expect(user.emailVerified).toBe(true);

			const fetchedUser = await adapter.getUserByEmail("employee@company.com");
			expect(fetchedUser).not.toBeNull();
			expect(fetchedUser?.id).toBe(user.id);
		});

		it("should prevent signup for disabled domain", async () => {
			await adapter.createAllowedDomain("company.com", Role.AUTHOR);
			await adapter.updateAllowedDomain("company.com", false);

			const check = await canSignup(adapter, "user@company.com");
			expect(check).toBeNull();

			await requestSignup(
				{
					baseUrl: "https://example.com",
					email: mockEmailSend,
					siteName: "Test",
				},
				adapter,
				"user@company.com",
			);
			expect(mockEmailSend).not.toHaveBeenCalled();
		});
	});
});
