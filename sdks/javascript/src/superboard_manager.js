import SuperBoardAPIService from "./superboard_api_service.js";
import SuperBoardContext from "./superboard_context.js";
import SuperBoardDeviceDetails from "./superboard_device_details.js";
import SuperBoardEventsManager from "./superboard_events_manager.js";
import SuperBoardUIHelper from "./superboard_ui_helper.js";

const AUTHENTICATION_REQUIRED_MESSAGE =
	"The SuperBoard SDK is not authenticated. Call start() and wait for its success callback before using this method.";

/**
 * Manages interactions with the SuperBoard API and event handling.
 */
class SuperBoardManager {
	/**
	 * Creates an instance of SuperBoardManager.
	 * @param {string} APIKey - The API key for authentication.
	 * @param {boolean} testEnvironment - Indicates if the environment is a test environment.
	 * @param {Function} linkHandlingCallback - Callback function to handle SuperBoard data.
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
		SuperBoardContext.API_KEY = APIKey;
		SuperBoardContext.testEnvironment = testEnvironment;
		SuperBoardContext.API_BASE_URL = `${parsedBaseURL.origin}/api/v1/sdk`;

		// Initialize callback for handling links
		this.linkHandlingCallback = linkHandlingCallback;
		// Initialize API service for making requests
		this.service = new SuperBoardAPIService();
		// Initialize event manager for handling events
		this.eventsManager = new SuperBoardEventsManager();
		// Authentication status
		this.authenticated = false;
		// Monotonically identifies authentication attempts so a late response from
		// an older attempt cannot reopen the SDK after a newer attempt failed.
		this.authenticationAttempt = 0;
		// Flag to determine if identifiers need updating
		this.shouldUpdateIdentifiers = false;
		// Initialize UI helper for UI interactions
		this.uiHelper = new SuperBoardUIHelper();
		// Array to store received data
		this.receivedData = [];
	}

	// MARK: Methods

	/**
	 * Authenticates with the SuperBoard API.
	 * @param {Function} [successfulAuthenticatedCallback] - Callback function invoked upon successful authentication.
	 * @param {Function} [authenticationErrorCallback] - Callback function invoked when authentication fails.
	 */
	authenticate(successfulAuthenticatedCallback, authenticationErrorCallback) {
		const authenticationAttempt = ++this.authenticationAttempt;
		this.authenticated = false;

		// Get the current device details
		const details = SuperBoardDeviceDetails.currentDetails();

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

				// Set SuperBoard ID cookie for future use
				SuperBoardContext.setLinksquaredIDCookie(linksquaredID);

				// Update context attributes only if identifiers are not being updated
				if (!self.shouldUpdateIdentifiers) {
					SuperBoardContext.USER_IDENTIFIER = identifier;
					SuperBoardContext.USER_ATTRIBUTES = attributes;
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
						"SuperBoard authentication failed; authenticated API calls are disabled.",
						error,
					);
				}
			},
		);
	}

	/**
	 * Sets the user identifier.
	 * @param {string} identifier - The user identifier.
	 */
	setUserIdentifier(identifier) {
		SuperBoardContext.USER_IDENTIFIER = identifier;

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
		SuperBoardContext.USER_ATTRIBUTES = attributes;

		// Mark for identifier update if not authenticated
		if (!this.authenticated) {
			this.shouldUpdateIdentifiers = true;
		}

		this.#updateUserAttributesIfNeeded();
	}

	/**
	 * Retrieves the user identifier from the SuperBoardContext.
	 * @returns {string|null} The user identifier. Null if not authenticated.
	 */
	userIdentifier() {
		return SuperBoardContext.USER_IDENTIFIER;
	}

	/**
	 * Retrieves the user attributes from the SuperBoardContext.
	 * @returns {Object|null} The user attributes. Null if not authenticated.
	 */
	userAttributes() {
		return SuperBoardContext.USER_ATTRIBUTES;
	}

	/**
	 * Creates a link with the SuperBoard API.
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
				error("You must configure the redirect rules in the Web interface first");
			},
			error, // Error callback for the service
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
			(_response) => {
				// Disabled for now
				// const notifications = response.notifications;
				// notifications.forEach((item) => {
				//   this.uiHelper.openPage(item);
				// });
			},
			(_error) => {
				console.log("SuperBoard -- could not get automatic notifications!");
			},
		);
	}

	/**
	 * Handles fetching data from SuperBoard API.
	 * Determines whether to fetch data for the current device or a specific path.
	 * @private
	 */
	#handleFetchData() {
		const SuperBoardValue = SuperBoardDeviceDetails.getSuperBoardPath();
		console.log("SuperBoard - value extracted from the link", SuperBoardValue);
		// Check if a specific path is set
		if (SuperBoardValue) {
			this.#handleSuperBoardValue(SuperBoardValue);
		} else {
			this.#handleDataForDevice();
		}

		// Fetch automatic messages
		this.#displayAutomaticMessages();
	}

	/**
	 * Handles fetching data for a specific path from SuperBoard API.
	 * @param {string} path - The path for which to fetch data.
	 * @private
	 */
	#handleSuperBoardValue(path) {
		const details = SuperBoardDeviceDetails.currentDetails();
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
			(_error) => {
				console.log("SuperBoard -- could not fetch data!");
			},
		);
	}

	/**
	 * Handles fetching data for the current device from SuperBoard API.
	 * @private
	 */
	#handleDataForDevice() {
		const details = SuperBoardDeviceDetails.currentDetails();
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
			(_error) => {
				console.log("SuperBoard -- could not fetch data!");
			},
		);
	}

	/**
	 * Handles received data from SuperBoard API.
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
			(_response) => {
				self.shouldUpdateIdentifiers = false; // Reset update flag
			},
			/**
			 * Error callback for updating user attributes.
			 * @param {Object} error - The error object.
			 */
			(_error) => {
				console.log("SuperBoard -- could not set identifiers!");
			},
		);
	}
}

export default SuperBoardManager;
