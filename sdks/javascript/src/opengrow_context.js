// Import the OpenGrowDeviceDetails module
import OpenGrowDeviceDetails from "./opengrow_device_details.js";

// Define the OpenGrowContext class
class OpenGrowContext {
  // Static properties to store API key and OpenGrow ID
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
   * Application-provided OpenGrow SDK endpoint, including `/api/v1/sdk`.
   * @type {string|null}
   */
  static API_BASE_URL = null;

  static get linksquaredID() {
    return OpenGrowDeviceDetails.getValue("linksquared");
  }

  /**
   * Set OpenGrow ID cookie.
   * @param {string} id - OpenGrow ID to be stored in the cookie.
   */
  static setLinksquaredIDCookie(id) {
    OpenGrowDeviceDetails.setValue("linksquared", id);
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

// Export the OpenGrowContext class
export default OpenGrowContext;
