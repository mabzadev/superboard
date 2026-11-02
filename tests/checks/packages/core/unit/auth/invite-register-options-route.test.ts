import type { EmailMessage, EmailSendFn } from "@emdash-cms/auth";
import { Role, createInvite } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import type { Kysely } from "kysely";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { _resetEnvCache } from "../../../../../../packages/core/src/api/public-url.js";
import { POST as inviteRegisterOptions } from "../../../../../../packages/core/src/astro/routes/api/auth/invite/register-options.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

const TOKEN_EXTRACT_REGEX = /token=([a-zA-Z0-9_-]+)/;

describe("invite register-options route — siteUrl resolution (issue #994)", () => {
	let db: Kysely<Database>;
	let adminId: string;
	let inviteToken: string;

	beforeEach(async () => {
		db = await setupTestDatabase();
		_resetEnvCache();

		const adapter = createKyselyAdapter(db);

		const admin = await adapter.createUser({
			email: "admin@example.com",
			name: "Admin",
			role: Role.ADMIN,
			emailVerified: true,
		});
		adminId = admin.id;

		let captured: string | null = null;
		const mockSend: EmailSendFn = vi.fn(async (msg: EmailMessage) => {
			const match = msg.text.match(TOKEN_EXTRACT_REGEX);
			captured = match ? (match[1] ?? null) : null;
		});

		await createInvite(
			{ baseUrl: "https://staging.example.com", siteName: "Test", email: mockSend },
			adapter,
			"newuser@example.com",
			Role.AUTHOR,
			adminId,
		);

		if (!captured) throw new Error("failed to capture invite token");
		inviteToken = captured;
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
		_resetEnvCache();
	});

	it("uses the public siteUrl from config for the passkey RP, not the internal hostname", async () => {
		const request = new Request("http://localhost:4321/_emdash/api/auth/invite/register-options", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token: inviteToken, name: "New User" }),
		});

		const response = await inviteRegisterOptions({
			request,
			locals: {
				emdash: {
					db,
					config: { siteUrl: "https://staging.example.com" },
				},
			},
		} as Parameters<typeof inviteRegisterOptions>[0]);

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			data: { options: { rp: { id: string; name: string } } };
		};

		expect(body.data.options.rp.id).toBe("staging.example.com");
		expect(body.data.options.rp.id).not.toBe("localhost");
	});

	it("falls back to the request hostname when no siteUrl is configured", async () => {
		const request = new Request("http://localhost:4321/_emdash/api/auth/invite/register-options", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token: inviteToken }),
		});

		const response = await inviteRegisterOptions({
			request,
			locals: {
				emdash: {
					db,
					config: {},
				},
			},
		} as Parameters<typeof inviteRegisterOptions>[0]);

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			data: { options: { rp: { id: string } } };
		};
		expect(body.data.options.rp.id).toBe("localhost");
	});
});
