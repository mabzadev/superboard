import { beforeEach, describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", () => ({ GET: requests.get }));
vi.mock("@/lib/config", () => ({ config: { apiPath: "/api/v1" } }));

import {
  getApplicationUser,
  getApplicationUsers,
} from "../applicationUsersService";

describe("application users administration service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requests.get.mockResolvedValue({
      data: {
        data: [{ id: "user-1" }],
        meta: { total: 1, limit: 25, offset: 50, has_more: false },
      },
    });
  });

  it("uses a project-scoped, encoded and paginated route", async () => {
    await getApplicationUsers("10-test", {
      query: "person+google@example.test",
      limit: 25,
      offset: 50,
    });
    expect(requests.get).toHaveBeenCalledWith(
      "/api/v1/application-users/projects/10-test/users?limit=25&offset=50&q=person%2Bgoogle%40example.test"
    );
  });

  it("unwraps one sanitized identity detail", async () => {
    requests.get.mockResolvedValueOnce({
      data: { data: { id: "user/one", auth_methods: ["apple"] } },
    });
    await expect(getApplicationUser("10-prod", "user/one")).resolves.toEqual({
      id: "user/one",
      auth_methods: ["apple"],
    });
    expect(requests.get).toHaveBeenCalledWith(
      "/api/v1/application-users/projects/10-prod/users/user%2Fone"
    );
  });
});
