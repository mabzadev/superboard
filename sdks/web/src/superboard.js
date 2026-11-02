import { SuperBoardClient, SuperBoardError } from "./client.js";
import SuperBoardManager from "./superboard_manager.js";
import {
	SuperBoardSupportClient,
	SuperBoardSupportException,
	SuperBoardSupportRealtime,
	SuperBoardSupportWidget,
} from "./support/index.js";

class SuperBoard {
	/**
	 * Creates an instance of the SuperBoard SDK.
	 * @param {string} APIKey - The API key for authentication.
	 * @param {boolean} testEnvironment - Indicates if the environment is a test environment.
	 * @param {Function} linkHandlingCallback - Callback function to handle SuperBoard data.
	 * @param {string} baseURL - Application-specific SDK origin, for example `https://sdk.example.com`.
	 */
	constructor(APIKey, testEnvironment, linkHandlingCallback, baseURL) {
		this.manager = new SuperBoardManager(APIKey, testEnvironment, linkHandlingCallback, baseURL);
	}

	/**
	 * Starts the SuperBoard SDK by authenticating with the API.
	 * Optionally takes a callback that is called upon successful authentication.
	 * @param {Function} [successfulAuthenticatedCallback=null] - Callback to invoke on successful authentication.
	 * @param {Function} [authenticationErrorCallback=null] - Callback to invoke when authentication fails.
	 */
	start(successfulAuthenticatedCallback = null, authenticationErrorCallback = null) {
		this.manager.authenticate(successfulAuthenticatedCallback, authenticationErrorCallback);
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
		this.manager.createLink(title, subtitle, imageURL, data, success, error);
	}

	/**
	 * Retrieves the user identifier from the manager.
	 * @returns {string|null} The user identifier, or null if not set.
	 */
	userIdentifier() {
		return this.manager.userIdentifier();
	}

	/**
	 * Retrieves the user attributes from the manager.
	 * @returns {Object|null} The user attributes, or null if not set.
	 */
	userAttributes() {
		return this.manager.userAttributes();
	}

	/**
	 * Sets the user identifier in the manager.
	 * @param {string} identifier - The user identifier to set.
	 * @returns {void}
	 */
	setUserIdentifier(identifier) {
		this.manager.setUserIdentifier(identifier);
	}

	/**
	 * Sets the user attributes in the manager.
	 * @param {Object} attributes - A dictionary of user attributes to set.
	 * @returns {void}
	 */
	setUserAttributes(attributes) {
		this.manager.setUserAttributes(attributes);
	}

	/**
	 * Checks if the SDK is authenticated.
	 * This method returns the authentication status of the SDK.
	 * @returns {boolean} - The authentication status of the manager.
	 */
	authenticated() {
		return this.manager.authenticated;
	}

	/**
	 * Displays the messages list using the manager.
	 * This method triggers the display of the messages list in the UI.
	 * @param {Function} [error] - Callback invoked if authentication is required.
	 * @returns {void}
	 */
	showMessagesList(error) {
		this.manager.showMessagesList(error);
	}

	/**
	 * Retrieves messages for a specific page using the manager.
	 * @param {number} page - The page number to retrieve messages from.
	 * @param {Function} response - Callback to handle the retrieved messages.
	 * @param {Function} error - Callback to handle any errors during retrieval.
	 * @returns {void}
	 */
	getMessages(page, response, error) {
		this.manager.getMessages(page, response, error);
	}

	/**
	 * Retrieves the number of unread messages using the manager.
	 * @param {Function} response - Callback to handle the count of unread messages.
	 * @param {Function} error - Callback to handle any errors during retrieval.
	 * @returns {void}
	 */
	getNumberOfUnreadMessages(response, error) {
		this.manager.getNumberOfUnreadMessages(response, error);
	}

	/**
	 * Returns all the received data since startup.
	 * @returns {Array} Array of all received data objects.
	 */
	getAllReceivedData() {
		return this.manager.getAllReceivedData();
	}

	/**
	 * Marks a message as read.
	 * @param {Object} message - The message to be marked as read.
	 * @param {Function} response - Callback for success.
	 * @param {Function} error - Callback for error.
	 * @returns {void}
	 */
	markMessageAsRead(message, response, error) {
		this.manager.markMessageAsRead(message, response, error);
	}
}

Object.defineProperties(SuperBoard, {
	SuperBoardClient: { value: SuperBoardClient, enumerable: true },
	SuperBoardError: { value: SuperBoardError, enumerable: true },
	SuperBoardSupportClient: { value: SuperBoardSupportClient, enumerable: true },
	SuperBoardSupportException: {
		value: SuperBoardSupportException,
		enumerable: true,
	},
	SuperBoardSupportRealtime: {
		value: SuperBoardSupportRealtime,
		enumerable: true,
	},
	SuperBoardSupportWidget: { value: SuperBoardSupportWidget, enumerable: true },
});

export default SuperBoard;
