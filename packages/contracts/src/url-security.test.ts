import { describe, expect, it } from "vitest";
import { isSafePublicHttpsUrl } from "./url-security";

describe("public HTTPS URL policy", () => {
  it("accepts normal HTTPS webhook endpoints", () => {
    expect(isSafePublicHttpsUrl("https://hooks.example.test/opengrow?source=support")).toBe(true);
  });

  it.each([
    "http://hooks.example.test",
    "https://user:password@hooks.example.test",
    "https://localhost/hook",
    "https://service.internal/hook",
    "https://127.0.0.1/hook",
    "https://10.0.0.1/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://192.168.1.2/hook",
    "https://[::1]/hook",
    "https://hooks.example.test/hook#fragment",
  ])("rejects unsafe endpoint %s", (value) => {
    expect(isSafePublicHttpsUrl(value)).toBe(false);
  });
});
