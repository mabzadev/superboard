// Define the OpenGrowDeviceDetails class
class OpenGrowDeviceDetails {
  /**
   * Helper function to check if running in Electron.
   * @returns {boolean} - True if in Electron, otherwise false.
   */
  static isElectron() {
    return (
      typeof navigator !== "undefined" &&
      navigator.userAgent.includes("Electron")
    );
  }

  /**
   * Get current device details.
   * @returns {Object} - Object containing user agent, app version, and build.
   */
  static currentDetails() {
    const userAgent =
      typeof navigator !== "undefined" && navigator.userAgent
        ? navigator.userAgent
        : "unknown";

    // Initialize return values object
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
      return localStorage.getItem(name); // Use local storage in Electron
    } else if (typeof document !== "undefined") {
      const cookies = document.cookie.split(";"); // Split cookies into an array
      for (let cookie of cookies) {
        const [key, value] = cookie.trim().split("="); // Split each cookie into name and value
        if (key === name) {
          return decodeURIComponent(value); // Return the decoded cookie value
        }
      }
      return null; // Return null if the item is not found
    }
    return null;
  }

  /**
   * Removes a cookie or local storage item by name.
   * @param {string} name - Name of the item to remove.
   */
  static removeValue(name) {
    if (this.isElectron()) {
      localStorage.removeItem(name); // Remove item from local storage in Electron
    } else if (typeof document !== "undefined") {
      // Set the cookie's expiration date to the past
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
      localStorage.setItem(name, value); // Set value in local storage in Electron
    } else if (typeof document !== "undefined") {
      // Set expiration date to a far-future date
      const farFutureDate = new Date("9999-12-31");
      const expires = "expires=" + farFutureDate.toUTCString();

      // Set the cookie
      document.cookie =
        name + "=" + encodeURIComponent(value) + ";" + expires + ";path=/";
    }
  }

  /**
   * Get the value of the "OpenGrow" parameter from the current URL.
   * @returns {string|null} - Value of the "OpenGrow" parameter, or null if not found.
   */
  static getOpenGrowPath() {
    let openGrowValue = null;
    if (
      typeof window !== "undefined" &&
      window.location &&
      typeof window.location.href === "string"
    ) {
      try {
        // URLSearchParams already percent-decodes once. Calling
        // decodeURIComponent here would corrupt values containing a literal
        // percent-encoded sequence such as `a%2Fb`.
        openGrowValue = new URL(window.location.href).searchParams.get(
          "OpenGrow",
        );
      } catch {
        // A host can expose a partial Location mock. Treat an invalid href as
        // absent input instead of breaking SDK initialization.
      }
    }

    if (openGrowValue != null) {
      this.setValue("OpenGrow_path", openGrowValue);
      return openGrowValue;
    }

    // Return a persisted attribution only once.
    const value = this.getValue("OpenGrow_path");
    this.removeValue("OpenGrow_path");
    return value;
  }
}

// Export the OpenGrowDeviceDetails class
export default OpenGrowDeviceDetails;
