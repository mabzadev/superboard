import { StorageKey } from "@melody-auth/shared";
import { getCookie } from "cookies-next";
import { expect, test, vi } from "vitest";
import { getServerSession } from "../../../../../../../sdks/web/identity/nextjs/src/middleware/serverAuth.js";
vi.mock("cookies-next", () => ({ getCookie: vi.fn(), setCookie: vi.fn() }));
test("server sessions await asynchronous cookie reads", async () => {
	const access = {
		accessToken: "access",
		expiresIn: 3600,
		expiresOn: Math.floor(Date.now() / 1000) + 3600,
	};
	vi.mocked(getCookie).mockImplementation(async (key) =>
		key === StorageKey.AccessToken ? JSON.stringify(access) : undefined,
	);
	await expect(
		getServerSession({
			clientId: "app",
			serverUrl: "https://auth.example.test",
			redirectUri: "https://app.example.test",
		}),
	).resolves.toMatchObject({ accessToken: "access", isAuthenticated: true });
});
