import { describe, it, expect } from "vitest";
import { migrationErrorToCopy } from "@/lib/migrationErrorToCopy";
import { ApiError } from "@/lib/ApiError";

function err(status: number, message: string) {
  return new ApiError(message, status, undefined, { error: message });
}

describe("migrationErrorToCopy", () => {
  it("409 already configured → readable", () => {
    const c = migrationErrorToCopy(
      err(409, "Migration source already configured for this project")
    );
    expect(c).toMatch(/already configured/i);
  });
  it("409 host owned elsewhere", () => {
    const c = migrationErrorToCopy(
      err(409, "old_host is attached as a custom domain on a different project")
    );
    expect(c).toMatch(/different project/i);
  });
  it("422 custom domain not active → guidance", () => {
    const c = migrationErrorToCopy(
      err(422, "Old host custom domain is not active yet (status: pending)")
    );
    expect(c).toMatch(/active/i);
  });
  it("422 credentials missing keys", () => {
    const c = migrationErrorToCopy(
      err(422, "Credentials missing keys: branch_key")
    );
    expect(c).toMatch(/credentials/i);
  });
  it("429 too many probes", () => {
    const c = migrationErrorToCopy(
      err(429, "Too many probes for this source — try again in a minute")
    );
    expect(c).toMatch(/minute|again/i);
  });
  it("503 → feature unavailable copy", () => {
    const c = migrationErrorToCopy(
      err(503, "Migrations are not enabled in this deployment")
    );
    expect(c).toMatch(/unavailable|not enabled/i);
  });
  it("403 forbidden", () => {
    const c = migrationErrorToCopy(err(403, "Forbidden"));
    expect(c).toMatch(/admin/i);
  });
  it("unknown error falls back to the server message", () => {
    const c = migrationErrorToCopy(err(500, "kaboom"));
    expect(c).toMatch(/kaboom|something/i);
  });
});
