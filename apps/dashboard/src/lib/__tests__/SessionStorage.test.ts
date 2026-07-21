import { describe, it, expect, beforeEach } from "vitest";
import SessionStorage from "../SessionStorage";

describe("SessionStorage", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe("date filter", () => {
    it("sets and gets date filter", () => {
      SessionStorage.setDateFilter("2026-01-01");
      expect(SessionStorage.getDateFilter()).toBe("2026-01-01");
    });

    it("returns null when no date filter set", () => {
      expect(SessionStorage.getDateFilter()).toBeNull();
    });

    it("overwrites previous value", () => {
      SessionStorage.setDateFilter("2026-01-01");
      SessionStorage.setDateFilter("2026-06-15");
      expect(SessionStorage.getDateFilter()).toBe("2026-06-15");
    });
  });
});
