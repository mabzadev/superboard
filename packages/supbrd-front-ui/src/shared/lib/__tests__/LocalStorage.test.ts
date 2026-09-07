import { describe, it, expect, beforeEach } from "vitest";

import LocalStorage from "../LocalStorage.js";

describe("LocalStorage", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	describe("dashboard cards", () => {
		it("stores and retrieves cards as array", () => {
			LocalStorage.setDashboardCards(["card1", "card2", "card3"]);
			expect(LocalStorage.getDashboardCards()).toEqual(["card1", "card2", "card3"]);
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
