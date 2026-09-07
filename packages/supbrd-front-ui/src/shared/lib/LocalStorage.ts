export default class LocalStorage {
	static setDashboardCards(cards: string[]): void {
		localStorage.setItem("dashboard_cards", cards.join(","));
	}
	static getDashboardCards(): string[] | null {
		const value = localStorage.getItem("dashboard_cards");
		return value ? value.split(",") : null;
	}
	static setPlatformFilter(platform: string): void {
		localStorage.setItem("platforms_filter", platform);
	}
	static getPlatformFilter(): string | null {
		return localStorage.getItem("platforms_filter");
	}
	static setLoginType(type: string): void {
		localStorage.setItem("login_type", type);
	}
	static getLoginType(): string | null {
		return localStorage.getItem("login_type");
	}
	static setCraftPreview(value: string): void {
		localStorage.setItem("craft-preview-data", value);
	}
	static getCraftPreview(): string | null {
		return localStorage.getItem("craft-preview-data");
	}
	static removeCraftPreview(): void {
		localStorage.removeItem("craft-preview-data");
	}
}
