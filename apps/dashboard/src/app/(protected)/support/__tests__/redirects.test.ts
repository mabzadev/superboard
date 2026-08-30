import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => navigation);

import ConfigurationRedirect from "../configuration/page";
import QualityRedirect from "../quality/page";

describe("Support route aliases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects configuration directly to native settings", () => {
    ConfigurationRedirect();
    expect(navigation.redirect).toHaveBeenCalledWith("/support/settings");
  });

  it("redirects quality directly to native reports", () => {
    QualityRedirect();
    expect(navigation.redirect).toHaveBeenCalledWith("/support/reports");
  });
});
