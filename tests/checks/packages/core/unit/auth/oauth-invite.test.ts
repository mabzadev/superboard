import type { AuthAdapter, OAuthProfile } from "@emdash-cms/auth";
import { Role, acceptInviteViaOAuth, createInviteToken, OAuthError } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { Kysely } from "kysely";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

const TOKEN_EXTRACT_REGEX = /token=([a-zA-Z0-9_-]+)/;

function makeProfile(overrides: Partial<OAuthProfile> = {}): OAuthProfile {
	return {
		id: "google-123",
		email: "invitee@example.com",
		name: "Invitee",
		avatarUrl: null,
		emailVerified: true,
		...overrides,
	};
}

describe("acceptInviteViaOAuth", () => {
	let db: Kysely<Database>;
	let adapter: AuthAdapter;
	let adminId: string;

	beforeEach(async () => {
		db = await setupTestDatabase();
		adapter = createKyselyAdapter(db);
		const admin = await adapter.createUser({
			email: "admin@example.com",
			name: "Admin",
			role: Role.ADMIN,
			emailVerified: true,
		});
		adminId = admin.id;
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	async function invite(email: string, role: number = Role.AUTHOR): Promise<string> {
		const { url } = await createInviteToken(
			{ baseUrl: "https://example.com/_emdash" },
			adapter,
			email,
			role,
			adminId,
		);
		const match = url.match(TOKEN_EXTRACT_REGEX);
		if (!match) throw new Error("could not extract invite token");
		return match[1];
	}

	it("completes the invite, sets the invited role, links the account, and consumes the token", async () => {
		const token = await invite("invitee@example.com", Role.EDITOR);

		const user = await acceptInviteViaOAuth(adapter, "google", makeProfile(), token);

		expect(user.email).toBe("invitee@example.com");
		expect(user.role).toBe(Role.EDITOR);

		const account = await adapter.getOAuthAccount("google", "google-123");
		expect(account?.userId).toBe(user.id);

		await expect(
			acceptInviteViaOAuth(adapter, "google", makeProfile({ id: "google-999" }), token),
		).rejects.toMatchObject({ code: "invite_invalid" });
	});

	it("matches the invited email case-insensitively", async () => {
		const token = await invite("Invitee@Example.com");

		const user = await acceptInviteViaOAuth(
			adapter,
			"google",
			makeProfile({ email: "invitee@example.com" }),
			token,
		);

		expect(user.email.toLowerCase()).toBe("invitee@example.com");
		expect(await adapter.getOAuthAccount("google", "google-123")).not.toBeNull();
	});

	it("rejects when the OAuth email does not match the invite", async () => {
		const token = await invite("invitee@example.com");

		await expect(
			acceptInviteViaOAuth(
				adapter,
				"google",
				makeProfile({ email: "someone-else@example.com" }),
				token,
			),
		).rejects.toMatchObject({ code: "invite_email_mismatch" });

		expect(await adapter.getUserByEmail("someone-else@example.com")).toBeNull();
	});

	it("rejects with a distinct code when the provider has not verified the email", async () => {
		const token = await invite("invitee@example.com");

		await expect(
			acceptInviteViaOAuth(adapter, "google", makeProfile({ emailVerified: false }), token),
		).rejects.toMatchObject({ code: "invite_email_unverified" });

		expect(await adapter.getUserByEmail("invitee@example.com")).toBeNull();
	});

	it("consumes the invite token when linking to a pre-existing account", async () => {
		const token = await invite("invitee@example.com");
		await adapter.createUser({
			email: "invitee@example.com",
			name: "Invitee",
			role: Role.AUTHOR,
			emailVerified: true,
		});

		const user = await acceptInviteViaOAuth(adapter, "google", makeProfile(), token);
		expect(user.email).toBe("invitee@example.com");
		expect(await adapter.getOAuthAccount("google", "google-123")).not.toBeNull();

		await expect(
			acceptInviteViaOAuth(adapter, "google", makeProfile({ id: "google-777" }), token),
		).rejects.toMatchObject({ code: "invite_invalid" });
	});

	it("rejects (and does not consume) when the already-linked account's user has a different email", async () => {
		const token = await invite("invitee@example.com");
		const other = await adapter.createUser({
			email: "other@example.com",
			name: "Other",
			role: Role.AUTHOR,
			emailVerified: true,
		});
		await adapter.createOAuthAccount({
			provider: "google",
			providerAccountId: "google-linked",
			userId: other.id,
		});

		await expect(
			acceptInviteViaOAuth(
				adapter,
				"google",
				makeProfile({ id: "google-linked", email: "invitee@example.com" }),
				token,
			),
		).rejects.toMatchObject({ code: "invite_email_mismatch" });

		const user = await acceptInviteViaOAuth(adapter, "google", makeProfile(), token);
		expect(user.email).toBe("invitee@example.com");
	});

	it("rejects an invalid or unknown invite token", async () => {
		await expect(
			acceptInviteViaOAuth(adapter, "google", makeProfile(), "not-a-real-token"),
		).rejects.toMatchObject({ code: "invite_invalid" });
	});

	it("throws OAuthError (not InviteError) so the callback maps it to a message", async () => {
		await expect(
			acceptInviteViaOAuth(adapter, "google", makeProfile(), "not-a-real-token"),
		).rejects.toBeInstanceOf(OAuthError);
	});
});
