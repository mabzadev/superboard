import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({
  GET: vi.fn(() => Promise.resolve({ data: {} })),
  POST: vi.fn(() => Promise.resolve({ data: {} })),
  PATCH: vi.fn(() => Promise.resolve({ data: {} })),
  DELETE: vi.fn(() => Promise.resolve({ data: {} })),
}));
vi.mock("@/lib/config", () => ({ config: { apiPath: "/api/v1" } }));

import { GET, POST, PATCH, DELETE } from "@/lib/api";
import {
  getMigrationSourceAPICall,
  createMigrationSourceAPICall,
  updateMigrationSourceAPICall,
  deleteMigrationSourceAPICall,
  testMigrationSourceAPICall,
} from "@/api/migrations/migrationsService";

describe("migration source service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET opts out of retries to avoid pounding on 503=feature-off", async () => {
    await getMigrationSourceAPICall("p1");
    expect(GET).toHaveBeenCalledWith("/api/v1/projects/p1/migration_source", {
      maxRetries: 0,
    });
  });
  it("POST", async () => {
    await createMigrationSourceAPICall("p1", {
      provider: "branch",
      old_host: "old.acme.com",
      credentials: { branch_key: "k" },
    });
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/projects/p1/migration_source",
      expect.objectContaining({ provider: "branch", old_host: "old.acme.com" })
    );
  });
  it("PATCH", async () => {
    await updateMigrationSourceAPICall("p1", { enabled: false });
    expect(PATCH).toHaveBeenCalledWith("/api/v1/projects/p1/migration_source", {
      enabled: false,
    });
  });
  it("DELETE", async () => {
    await deleteMigrationSourceAPICall("p1");
    expect(DELETE).toHaveBeenCalledWith("/api/v1/projects/p1/migration_source");
  });
  it("test", async () => {
    await testMigrationSourceAPICall("p1");
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/projects/p1/migration_source/test"
    );
  });
});
