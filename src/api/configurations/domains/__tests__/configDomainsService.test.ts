import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({
  GET: vi.fn(() => Promise.resolve({ data: {} })),
  POST: vi.fn(() => Promise.resolve({ data: {} })),
  PUT: vi.fn(() => Promise.resolve({ data: {} })),
  PATCH: vi.fn(() => Promise.resolve({ data: {} })),
  DELETE: vi.fn(() => Promise.resolve({ data: {} })),
}));

vi.mock("@/lib/config", () => ({ config: { apiPath: "/api/v1" } }));

import { GET, POST, DELETE } from "@/lib/api";
import {
  getCustomDomainsAPICall,
  addCustomDomainWithPurposeAPICall,
  removeCustomDomainByPurposeAPICall,
} from "@/api/configurations/domains/configDomainsService";

describe("plural custom_domains service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET hits plural path", async () => {
    await getCustomDomainsAPICall("p1");
    expect(GET).toHaveBeenCalledWith("/api/v1/projects/p1/custom_domains");
  });

  it("POST sends hostname + purpose", async () => {
    await addCustomDomainWithPurposeAPICall("p1", "old.acme.com", "migration");
    expect(POST).toHaveBeenCalledWith("/api/v1/projects/p1/custom_domains", {
      hostname: "old.acme.com",
      purpose: "migration",
    });
  });

  it("DELETE uses query param for purpose", async () => {
    await removeCustomDomainByPurposeAPICall("p1", "migration");
    expect(DELETE).toHaveBeenCalledWith(
      "/api/v1/projects/p1/custom_domains?purpose=migration"
    );
  });
});
