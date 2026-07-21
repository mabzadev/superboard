import { describe, it, expect, beforeEach } from "vitest";
import LocalStorage from "../LocalStorage";

describe("LocalStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("auth token", () => {
    it("sets and gets auth token", () => {
      LocalStorage.setAuthenticationToken("test-token");
      expect(LocalStorage.getAuthenticationToken()).toBe("test-token");
    });

    it("returns null when no token set", () => {
      expect(LocalStorage.getAuthenticationToken()).toBeNull();
    });
  });

  describe("refresh token", () => {
    it("sets and gets refresh token", () => {
      LocalStorage.setRefreshToken("refresh-123");
      expect(LocalStorage.getRefreshToken()).toBe("refresh-123");
    });
  });

  describe("current user", () => {
    it("stores and retrieves user object", () => {
      const user = { id: "1", name: "Test", email: "test@test.com" };
      LocalStorage.setCurrentUser(user);
      expect(LocalStorage.getCurrentUser()).toEqual(user);
    });

    it("returns null when no user set", () => {
      expect(LocalStorage.getCurrentUser()).toBeNull();
    });
  });

  describe("logoutUser", () => {
    it("clears auth token, refresh token, and user", () => {
      LocalStorage.setAuthenticationToken("token");
      LocalStorage.setRefreshToken("refresh");
      LocalStorage.setCurrentUser({ id: "1" });

      LocalStorage.logoutUser();

      expect(LocalStorage.getAuthenticationToken()).toBeNull();
      expect(LocalStorage.getRefreshToken()).toBeNull();
      expect(LocalStorage.getCurrentUser()).toBeNull();
    });
  });

  describe("dashboard cards", () => {
    it("stores and retrieves cards as array", () => {
      LocalStorage.setDashboardCards(["card1", "card2", "card3"]);
      expect(LocalStorage.getDashboardCards()).toEqual([
        "card1",
        "card2",
        "card3",
      ]);
    });

    it("returns null when no cards set", () => {
      expect(LocalStorage.getDashboardCards()).toBeNull();
    });
  });

  describe("login type", () => {
    it("sets and gets login type", () => {
      LocalStorage.setLoginType("sso");
      expect(LocalStorage.getLoginType()).toBe("sso");
    });
  });

  describe("platform filter", () => {
    it("sets and gets platform filter", () => {
      LocalStorage.setPlatformFilter("ios");
      expect(LocalStorage.getPlatformFilter()).toBe("ios");
    });
  });

  describe("craft preview", () => {
    it("sets, gets, and removes craft preview", () => {
      LocalStorage.setCraftPreview("preview-data");
      expect(LocalStorage.getCraftPreview()).toBe("preview-data");

      LocalStorage.removeCraftPreview();
      expect(LocalStorage.getCraftPreview()).toBeNull();
    });
  });
});
