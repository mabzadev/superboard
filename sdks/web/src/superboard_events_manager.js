import SuperBoardAPIService from "./superboard_api_service.js";
import SuperBoardDeviceDetails from "./superboard_device_details.js";

class Event {
	/**
	 * Constructs an Event instance.
	 * @param {string} type - The type of the event.
	 * @param {number} createdAt - The timestamp when the event occurred.
	 * @param {string|null} [path=null] - The path associated with the event.
	 * @param {number|null} [engagementTime=null] - The engagement time for the event.
	 */
	constructor(type, createdAt, path = null, engagementTime = null) {
		this.type = type;
		this.createdAt = createdAt;
		this.path = path;
		this.engagementTime = engagementTime;
	}
}

class EventsStorage {
	constructor() {
		this.storage = typeof localStorage !== "undefined" ? localStorage : null;
		try {
			this.events = JSON.parse(this.storage?.getItem("SuperBoard-events")) || [];
		} catch {
			this.events = [];
		}
	}

	/**
	 * Get all stored events.
	 * @returns {Array} All stored events.
	 */
	getEvents() {
		return this.events;
	}

	storeEventsLocally() {
		this.storage?.setItem("SuperBoard-events", JSON.stringify(this.events));
	}

	/**
	 * Store a single event.
	 * @param {Event} event - The event to store.
	 */
	storeEvent(event) {
		this.events.push(event);
		this.storeEventsLocally();
	}

	/**
	 * Store multiple events.
	 * @param {Array<Event>} events - Array of events to store.
	 */
	storeEvents(events) {
		this.events.push(...events);
		this.storeEventsLocally();
	}

	/**
	 * Delete an event by object reference.
	 * @param {Event} eventToDelete - The event to delete.
	 */
	deleteEvent(eventToDelete) {
		this.events = this.events.filter((event) => event !== eventToDelete);
		this.storeEventsLocally();
	}

	/**
	 * Get and remove all events.
	 * @returns {Array} All stored events.
	 */
	getAndRemoveAllEvents() {
		const eventsToReturn = this.events;
		this.events = [];
		this.storeEventsLocally();
		return eventsToReturn;
	}

	/**
	 * Set timestamp to localStorage.
	 * @param {number} timestamp - The timestamp to set.
	 */
	setTimestamp(timestamp) {
		this.storage?.setItem("SuperBoard-events-timestamp", JSON.stringify(timestamp));
	}

	/**
	 * Get timestamp from localStorage.
	 * @returns {number|null} The timestamp from localStorage.
	 */
	getTimestamp() {
		const storedTimestamp = this.storage?.getItem("SuperBoard-events-timestamp");
		try {
			return storedTimestamp ? JSON.parse(storedTimestamp) : null;
		} catch {
			return null;
		}
	}
}

class SuperBoardEventsManager {
	constructor() {
		this.service = new SuperBoardAPIService();
		this.eventsStorage = new EventsStorage();
		this.lastTimestamp = Date.now();

		const storedTimestamp = this.eventsStorage.getTimestamp();
		if (storedTimestamp) {
			this.setTimeSpent();
			this.lastTimestamp = storedTimestamp;
		}

		this.eventsStorage.setTimestamp(this.lastTimestamp);
		this.handleFocus();
	}

	/**
	 * Add event.
	 * @param {string} type - The type of the event.
	 */
	addEvent(type) {
		const event = new Event(type, Date.now(), SuperBoardDeviceDetails.getSuperBoardPath(), null);
		this.eventsStorage.storeEvent(event);
	}

	/**
	 * Add event and flush it to the server.
	 * @param {string} type - The type of the event.
	 */
	addEventWithFlush(type) {
		this.addEvent(type);
		this.flushEvents();
	}

	/**
	 * Handle focus event when the window gains focus.
	 * @private
	 */
	handleFocus() {
		if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
			return;
		}
		const self = this;
		window.addEventListener("focus", function () {
			self.setTimeSpent();
		});
	}

	/**
	 * Set time spent on the current page.
	 * @private
	 */
	setTimeSpent() {
		const storedTimestamp = this.eventsStorage.getTimestamp();
		if (storedTimestamp) {
			const currentTimestamp = Date.now();
			const differenceInMilliseconds = Math.abs(currentTimestamp - this.lastTimestamp);
			const differenceInSeconds = Math.floor(differenceInMilliseconds / 1000);
			this.setSecondsToEvents(differenceInSeconds);
			this.eventsStorage.setTimestamp(null);
		}
	}

	/**
	 * Set engagement time (in seconds) to events.
	 * @param {number} seconds - The seconds to set.
	 * @private
	 */
	setSecondsToEvents(seconds) {
		const events = this.eventsStorage.getAndRemoveAllEvents();
		events.forEach((event) => {
			if (event.engagementTime == null) {
				event.engagementTime = seconds;
			}
		});
		this.eventsStorage.storeEvents(events);
	}

	/**
	 * Flush events to the server by sending them and deleting locally.
	 * @private
	 */
	flushEvents() {
		this.setPathIfNeeded();
		const events = this.eventsStorage.getEvents();
		events.forEach((event) => {
			this.sendAndDeleteEvent(event);
		});
	}

	/**
	 * Set the path for events if it is not already set.
	 * @private
	 */
	setPathIfNeeded() {
		const path = SuperBoardDeviceDetails.getSuperBoardPath();
		if (!path) {
			return;
		}
		const events = this.eventsStorage.getAndRemoveAllEvents();
		events.forEach((event) => {
			if (event.path == null) {
				event.path = path;
			}
		});
		this.eventsStorage.storeEvents(events);
	}

	/**
	 * Send the event to the server and delete it from storage.
	 * @param {Event} event - The event to send and delete.
	 * @private
	 */
	sendAndDeleteEvent(event) {
		const self = this;
		this.service.createEvent(
			event.type,
			event.createdAt,
			event.path,
			event.engagementTime,
			(_response) => {
				self.eventsStorage.deleteEvent(event);
			},
			(_error) => {},
		);
	}
}

export default SuperBoardEventsManager;
