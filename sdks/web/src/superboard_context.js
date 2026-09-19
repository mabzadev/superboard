// Import the SuperBoardDeviceDetails module
import SuperBoardDeviceDetails from "./superboard_device_details.js";

// Define the SuperBoardContext class
class SuperBoardContext {
	// Static properties to store API key and SuperBoard ID
	/**
	 * The API key used for authentication.
	 * @type {string|null}
	 */
	static API_KEY = null;

	/**
	 * Indicates whether the application is running in a test environment.
	 * @type {boolean}
	 */
	static testEnvironment = false;

	/**
	 * Application-provided SuperBoard SDK endpoint, including `/api/v1/sdk`.
	 * @type {string|null}
	 */
	static API_BASE_URL = null;

	static get linksquaredID() {
		return SuperBoardDeviceDetails.getValue("linksquared");
	}

	/**
	 * Set SuperBoard ID cookie.
	 * @param {string} id - SuperBoard ID to be stored in the cookie.
	 */
	static setLinksquaredIDCookie(id) {
		SuperBoardDeviceDetails.setValue("linksquared", id);
	}

	/**
	 * Static property to store the user identifier.
	 * @type {string|null}
	 */
	static USER_IDENTIFIER = null;

	/**
	 * Static property to store the user attributes.
	 * @type {Object|null}
	 */
	static USER_ATTRIBUTES = null;
}

// Export the SuperBoardContext class
export default SuperBoardContext;
