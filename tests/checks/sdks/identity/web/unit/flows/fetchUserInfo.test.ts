import type { ProviderConfig } from "@melody-auth/shared";
import { describe, it, expect, vi } from "vitest";

import { fetchUserInfo } from "../../../../../../../sdks/identity/web/src/flows/fetchUserInfo";
import { getUserInfo } from "../../../../../../../sdks/identity/web/src/requests";

// Mock the requests module
vi.mock("../../../../../../../sdks/identity/web/src/requests", () => ({ getUserInfo: vi.fn() }));

describe("fetchUserInfo", () => {
	const mockProviderConfig: ProviderConfig = {
		serverUri: "https://test.server",
		clientId: "test-client-id",
		redirectUri: "https://test.redirect",
		scopes: ["test-scope"],
	};

	it("should fetch user info successfully", async () => {
		const mockUserInfo = {
			sub: "test-user-id",
			email: "test@example.com",
			name: "Test User",
		};

		vi.mocked(getUserInfo).mockResolvedValueOnce(mockUserInfo);

		const result = await fetchUserInfo(mockProviderConfig, "test-access-token");

		expect(getUserInfo).toHaveBeenCalledWith(mockProviderConfig, {
			accessToken: "test-access-token",
		});
		expect(result).toEqual(mockUserInfo);
	});

	it("should throw error when fetch fails", async () => {
		const error = new Error("Fetch failed");
		vi.mocked(getUserInfo).mockRejectedValueOnce(error);

		await expect(fetchUserInfo(mockProviderConfig, "test-access-token")).rejects.toThrow(
			"Failed to fetch user info: Error: Fetch failed",
		);
	});
});
