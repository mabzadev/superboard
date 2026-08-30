import type { AuthAdapter, EmailMessage, EmailSendFn } from "@emdash-cms/auth";
import {
	completeAdminEmailSetup,
	requestAdminEmailSetup,
	Role,
} from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "../../../src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

describe("Admin email setup", () => {
	let db: Kysely<Database>;
	let adapter: AuthAdapter;
	let sendEmail: EmailSendFn & ReturnType<typeof vi.fn>;
	let sentEmails: EmailMessage[];

	beforeEach(async () => {
		db = await setupTestDatabase();
		adapter = createKyselyAdapter(db);
		sentEmails = [];
		sendEmail = vi.fn(async (message: EmailMessage) => {
			sentEmails.push(message);
		});
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("creates the first admin only after the single-use email link is verified", async () => {
		await requestAdminEmailSetup(
			{
				baseUrl: "https://site.mbza.dev",
				siteName: "SuperBoard",
				email: sendEmail,
			},
			adapter,
			"MabzaDev@gmail.com",
		);

		expect(sendEmail).toHaveBeenCalledOnce();
		expect(sentEmails[0]?.to).toBe("mabzadev@gmail.com");
		const url = new URL(sentEmails[0]!.text.match(/https:\/\/\S+/u)![0]);
		expect(url.pathname).toBe("/_emdash/api/setup/admin/email/verify");
		expect(await adapter.countUsers()).toBe(0);

		const user = await completeAdminEmailSetup(
			adapter,
			url.searchParams.get("token")!,
			{ name: "Mabza", expectedEmail: "mabzadev@gmail.com" },
		);
		expect(user).toMatchObject({
			email: "mabzadev@gmail.com",
			name: "Mabza",
			role: Role.ADMIN,
			emailVerified: true,
		});
		expect(await adapter.countUsers()).toBe(1);
		await expect(
			completeAdminEmailSetup(adapter, url.searchParams.get("token")!, {
				name: "Mabza",
				expectedEmail: "mabzadev@gmail.com",
			}),
		).rejects.toThrow(/invalid|expired/u);
	});
});
