export default class LocalStorage {
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
