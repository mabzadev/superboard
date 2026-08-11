import OpenGrowAPIService from "./opengrow_api_service.js";
import OpenGrowEventsManager from "./opengrow_events_manager.js";
import OpenGrowContext from "./opengrow_context.js";
import OpenGrowDeviceDetails from "./opengrow_device_details.js";
import OpenGrowUIHelper from "./opengrow_ui_helper.js";

const AUTHENTICATION_REQUIRED_MESSAGE =
  "The OpenGrow SDK is not authenticated. Call start() and wait for its success callback before using this method.";

/**
 * Manages interactions with the OpenGrow API and event handling.
 */
class OpenGrowManager {
  /**
   * Creates an instance of OpenGrowManager.
   * @param {string} APIKey - The API key for authentication.
   * @param {boolean} testEnvironment - Indicates if the environment is a test environment.
   * @param {Function} linkHandlingCallback - Callback function to handle OpenGrow data.
   * @param {string} baseURL - Application-specific SDK origin.
   */
  constructor(APIKey, testEnvironment, linkHandlingCallback, baseURL) {
    let parsedBaseURL;
    try {
      parsedBaseURL = new URL(baseURL);
    } catch {
      throw new TypeError("baseURL must be an absolute HTTP(S) URL");
    }
    if (!/^https?:$/.test(parsedBaseURL.protocol) || !parsedBaseURL.hostname) {
      throw new TypeError("baseURL must be an absolute HTTP(S) URL");
    }
    // Set API key and environment in the context
    OpenGrowContext.API_KEY = APIKey;
    OpenGrowContext.testEnvironment = testEnvironment;
    OpenGrowContext.API_BASE_URL = `${parsedBaseURL.origin}/api/v1/sdk`;

    // Initialize callback for handling links
    this.linkHandlingCallback = linkHandlingCallback;
    // Initialize API service for making requests
    this.service = new OpenGrowAPIService();
    // Initialize event manager for handling events
    this.eventsManager = new OpenGrowEventsManager();
    // Authentication status
    this.authenticated = false;
    // Monotonically identifies authentication attempts so a late response from
    // an older attempt cannot reopen the SDK after a newer attempt failed.
    this.authenticationAttempt = 0;
    // Flag to determine if identifiers need updating
    this.shouldUpdateIdentifiers = false;
    // Initialize UI helper for UI interactions
    this.uiHelper = new OpenGrowUIHelper();
    // Array to store received data
    this.receivedData = [];
  }

  // MARK: Methods

  /**
   * Authenticates with the OpenGrow API.
   * @param {Function} [successfulAuthenticatedCallback] - Callback function invoked upon successful authentication.
   * @param {Function} [authenticationErrorCallback] - Callback function invoked when authentication fails.
   */
  authenticate(successfulAuthenticatedCallback, authenticationErrorCallback) {
    const authenticationAttempt = ++this.authenticationAttempt;
    this.authenticated = false;

    // Get the current device details
    const details = OpenGrowDeviceDetails.currentDetails();

    const self = this; // Preserve context for callbacks
    this.service.authenticateDevice(
      details,
      /**
       * Success callback for authentication.
       * @param {Object} response - The authentication response.
       */
      (response) => {
        if (authenticationAttempt !== self.authenticationAttempt) {
          return;
        }

        // Extract relevant data from response
        const linksquaredID = response.linksquared;
        const identifier = response.sdk_identifier;
        const attributes = response.sdk_attributes;

        // Set OpenGrow ID cookie for future use
        OpenGrowContext.setLinksquaredIDCookie(linksquaredID);

        // Update context attributes only if identifiers are not being updated
        if (!self.shouldUpdateIdentifiers) {
          OpenGrowContext.USER_IDENTIFIER = identifier;
          OpenGrowContext.USER_ATTRIBUTES = attributes;
        }

        // Mark as authenticated
        self.authenticated = true;

        // Call the success callback if provided
        if (successfulAuthenticatedCallback) {
          successfulAuthenticatedCallback();
        }

        // Handle data fetching and event flushing
        self.#handleFetchData();
        self.#updateUserAttributesIfNeeded();
        self.eventsManager.flushEvents();
      },
      /**
       * Error callback for authentication.
       * @param {Object} error - The authentication error.
       */
      (error) => {
        if (authenticationAttempt !== self.authenticationAttempt) {
          return;
        }

        self.authenticated = false;
        if (authenticationErrorCallback) {
          authenticationErrorCallback(error);
        } else {
          console.error(
            "OpenGrow authentication failed; authenticated API calls are disabled.",
            error,
          );
        }
      }
    );
  }

  /**
   * Sets the user identifier.
   * @param {string} identifier - The user identifier.
   */
  setUserIdentifier(identifier) {
    OpenGrowContext.USER_IDENTIFIER = identifier;

    // Mark for identifier update if not authenticated
    if (!this.authenticated) {
      this.shouldUpdateIdentifiers = true;
    }

    this.#updateUserAttributesIfNeeded();
  }

  /**
   * Sets the user attributes.
   * @param {Object} attributes - A dictionary of user attributes.
   */
  setUserAttributes(attributes) {
    OpenGrowContext.USER_ATTRIBUTES = attributes;

    // Mark for identifier update if not authenticated
    if (!this.authenticated) {
      this.shouldUpdateIdentifiers = true;
    }

    this.#updateUserAttributesIfNeeded();
  }

  /**
   * Retrieves the user identifier from the OpenGrowContext.
   * @returns {string|null} The user identifier. Null if not authenticated.
   */
  userIdentifier() {
    return OpenGrowContext.USER_IDENTIFIER;
  }

  /**
   * Retrieves the user attributes from the OpenGrowContext.
   * @returns {Object|null} The user attributes. Null if not authenticated.
   */
  userAttributes() {
    return OpenGrowContext.USER_ATTRIBUTES;
  }

  /**
   * Creates a link with the OpenGrow API.
   * @param {string} title - The title of the link.
   * @param {string} subtitle - The subtitle of the link.
   * @param {string} imageURL - The URL of the image associated with the link.
   * @param {Object} data - Additional data for the link.
   * @param {Function} success - Success callback for creating the link.
   * @param {Function} error - Error callback for creating the link.
   */
  createLink(title, subtitle, imageURL, data, success, error) {
    if (!this.#requireAuthentication(error)) {
      return;
    }

    this.service.createLink(
      title,
      subtitle,
      imageURL,
      data,
      /**
       * Success callback for creating the link.
       * @param {Object} response - The response from creating the link.
       */
      (response) => {
        if (response.link) {
          success(response.link);
          return;
        }

        // Error handling for link creation
        error(
          "You must configure the redirect rules in the Web interface first"
        );
      },
      error // Error callback for the service
    );
  }

  /**
   * Displays the messages list using the UI helper.
   * @param {Function} [error] - Error callback when the SDK is not authenticated.
   */
  showMessagesList(error) {
    if (!this.#requireAuthentication(error)) {
      return;
    }
    this.uiHelper.showMessagesList();
  }

  /**
   * Retrieves messages for the device.
   * @param {number} page - The page number for pagination.
   * @param {Function} response - Success callback for retrieving messages.
   * @param {Function} error - Error callback for retrieving messages.
   */
  getMessages(page, response, error) {
    if (!this.#requireAuthentication(error)) {
      return;
    }
    this.service.messagesForDevice(page, response, error);
  }

  /**
   * Retrieves the number of unread messages.
   * @param {Function} response - Success callback for the number of unread messages.
   * @param {Function} error - Error callback for retrieving the count.
   */
  getNumberOfUnreadMessages(response, error) {
    if (!this.#requireAuthentication(error)) {
      return;
    }
    this.service.numberOfUnreadMessages(response, error);
  }

  /**
   * Returns all the received data.
   * @returns {Array} Array of all received data objects.
   */
  getAllReceivedData() {
    return this.receivedData;
  }

  /**
   * Marks a message as read.
   * @param {Object} message - The message to mark as read.
   * @param {Function} response - Success callback for marking the message.
   * @param {Function} error - Error callback for marking the message.
   */
  markMessageAsRead(message, response, error) {
    if (!this.#requireAuthentication(error)) {
      return;
    }
    this.service.markMessageAsViewed(message, response, error);
  }

  // MARK: Private

  /**
   * Prevents every authenticated public operation from reaching the network
   * while authentication is pending or after it failed.
   * @param {Function} error - Optional error callback supplied by the caller.
   * @returns {boolean} Whether the operation may continue.
   * @private
   */
  #requireAuthentication(error) {
    if (this.authenticated) {
      return true;
    }

    if (typeof error === "function") {
      error(AUTHENTICATION_REQUIRED_MESSAGE);
    }
    return false;
  }

  /**
   * Displays automatic messages by fetching them from the service.
   * @private
   */
  #displayAutomaticMessages() {
    this.service.messagesForAutomaticDisplay(
      (response) => {
        // Disabled for now
        // const notifications = response.notifications;
        // notifications.forEach((item) => {
        //   this.uiHelper.openPage(item);
        // });
      },
      (error) => {
        console.log("OpenGrow -- could not get automatic notifications!");
      }
    );
  }

  /**
   * Handles fetching data from OpenGrow API.
   * Determines whether to fetch data for the current device or a specific path.
   * @private
   */
  #handleFetchData() {
    const OpenGrowValue = OpenGrowDeviceDetails.getOpenGrowPath();
    console.log("OpenGrow - value extracted from the link", OpenGrowValue);
    // Check if a specific path is set
    if (OpenGrowValue) {
      this.#handleOpenGrowValue(OpenGrowValue);
    } else {
      this.#handleDataForDevice();
    }

    // Fetch automatic messages
    this.#displayAutomaticMessages();
  }

  /**
   * Handles fetching data for a specific path from OpenGrow API.
   * @param {string} path - The path for which to fetch data.
   * @private
   */
  #handleOpenGrowValue(path) {
    let details = OpenGrowDeviceDetails.currentDetails();
    this.service.payloadForDeviceAndPath(
      details,
      path,
      /**
       * Success callback for fetching data for a specific path.
       * @param {Object} response - The response data.
       */
      (response) => {
        this.#handleDataReceived(response.data);
      },
      /**
       * Error callback for fetching data for a specific path.
       * @param {Object} error - The error object.
       */
      (error) => {
        console.log("OpenGrow -- could not fetch data!");
      }
    );
  }

  /**
   * Handles fetching data for the current device from OpenGrow API.
   * @private
   */
  #handleDataForDevice() {
    let details = OpenGrowDeviceDetails.currentDetails();
    const self = this; // Preserve context for callbacks

    this.service.payloadForDevice(
      details,
      /**
       * Success callback for fetching data for the current device.
       * @param {Object} response - The response data.
       */
      (response) => {
        self.#handleDataReceived(response.data);
      },
      /**
       * Error callback for fetching data for the current device.
       * @param {Object} error - The error object.
       */
      (error) => {
        console.log("OpenGrow -- could not fetch data!");
      }
    );
  }

  /**
   * Handles received data from OpenGrow API.
   * @param {Object} data - The received data.
   * @private
   */
  #handleDataReceived(data) {
    if (data) {
      // Store received data and invoke callback
      this.receivedData.push(data);
      this.linkHandlingCallback(data);
    }
  }

  /**
   * Updates user attributes if authenticated.
   * @private
   */
  #updateUserAttributesIfNeeded() {
    if (!this.authenticated) {
      return; // Do nothing if not authenticated
    }

    const self = this; // Preserve context for callbacks
    this.service.setUserAttributes(
      (response) => {
        self.shouldUpdateIdentifiers = false; // Reset update flag
      },
      /**
       * Error callback for updating user attributes.
       * @param {Object} error - The error object.
       */
      (error) => {
        console.log("OpenGrow -- could not set identifiers!");
      }
    );
  }
}

export default OpenGrowManager;
