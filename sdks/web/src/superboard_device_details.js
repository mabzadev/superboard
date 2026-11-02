class SuperBoardDeviceDetails {
	/**
	 * Helper function to check if running in Electron.
	 * @returns {boolean} - True if in Electron, otherwise false.
	 */
	static isElectron() {
		return typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");
	}

	/**
	 * Get current device details.
	 * @returns {Object} - Object containing user agent, app version, and build.
	 */
	static currentDetails() {
		const userAgent =
			typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : "unknown";

		const returnValues = {
			user_agent: userAgent,
			app_version: "0",
			build: "0",
		};

		return returnValues;
	}

	/**
	 * Get the value of a cookie or local storage item by name.
	 * @param {string} name - Name of the item to retrieve.
	 * @returns {string|null} - Value of the item, or null if not found.
	 */
	static getValue(name) {
		if (this.isElectron()) {
			return localStorage.getItem(name);
		} else if (typeof document !== "undefined") {
			const cookies = document.cookie.split(";");
			for (const cookie of cookies) {
				const [key, value] = cookie.trim().split("=");
				if (key === name) {
					return decodeURIComponent(value);
				}
			}
			return null;
		}
		return null;
	}

	/**
	 * Removes a cookie or local storage item by name.
	 * @param {string} name - Name of the item to remove.
	 */
	static removeValue(name) {
		if (this.isElectron()) {
			localStorage.removeItem(name);
		} else if (typeof document !== "undefined") {
			document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
		}
	}

	/**
	 * Set a cookie or local storage item with the given name and value.
	 * @param {string} name - Name of the item to set.
	 * @param {string} value - Value to set for the item.
	 */
	static setValue(name, value) {
		if (this.isElectron()) {
			localStorage.setItem(name, value);
		} else if (typeof document !== "undefined") {
			const farFutureDate = new Date("9999-12-31");
			const expires = "expires=" + farFutureDate.toUTCString();

			document.cookie = name + "=" + encodeURIComponent(value) + ";" + expires + ";path=/";
		}
	}

	/**
	 * Get the value of the "SuperBoard" parameter from the current URL.
	 * @returns {string|null} - Value of the "SuperBoard" parameter, or null if not found.
	 */
	static getSuperBoardPath() {
		let superBoardValue = null;
		if (
			typeof window !== "undefined" &&
			window.location &&
			typeof window.location.href === "string"
		) {
			try {
				superBoardValue = new URL(window.location.href).searchParams.get("SuperBoard");
			} catch {}
		}

		if (superBoardValue != null) {
			this.setValue("SuperBoard_path", superBoardValue);
			return superBoardValue;
		}

		const value = this.getValue("SuperBoard_path");
		this.removeValue("SuperBoard_path");
		return value;
	}
}

export default SuperBoardDeviceDetails;
