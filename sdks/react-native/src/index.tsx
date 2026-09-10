// index.ts - Unified wrapper with backward compatibility
import { NativeModules, NativeEventEmitter } from "react-native";

import { log } from "./Logger";
import type {
	LogLevel,
	DeeplinkResponse,
	CustomRedirects,
	Tracking,
	TransactionType,
	Any,
} from "./NativeSuperBoardWrapper";

const LINKING_ERROR = `The package '@mbzadev/superboard-react-native-sdk' doesn't seem to be linked. Make sure you properly integrated the native bindings.`;

// Feature detection for Turbo Modules
const isTurboModuleEnabled = (global as any).RN$Bridgeless === true;

interface SuperBoardWrapperInterface {
	setIdentifier(identifier?: string): void;
	setPushToken(pushToken?: string): void;
	setAttributes(attributes?: { [key: string]: Any }): void;
	setSDK(enabled: boolean): void;
	setDebug(level: LogLevel): void;
	generateLink(
		title?: string,
		subtitle?: string,
		imageURL?: string,
		data?: { [key: string]: Any },
		tags?: Array<Any>,
		customRedirects?: CustomRedirects,
		showPreviewIos?: boolean,
		showPreviewAndroid?: boolean,
		tracking?: Tracking,
	): Promise<string>;
	displayMessages(): Promise<void>;
	numberOfUnreadMessages(): Promise<number>;
	logInAppPurchase(transactionId: string): Promise<boolean>;
	logCustomPurchase(
		type: TransactionType,
		priceInCents: number,
		currency: string,
		productId: string,
		startDate?: string,
	): Promise<boolean>;
	onDeeplinkReceived: (callback: (data: DeeplinkResponse) => void) => {
		remove: () => void;
	};
	markReadyToHandleDeeplinks(): void;
}

function hasOnDeeplinkReceived(obj: unknown): obj is {
	onDeeplinkReceived: (callback: (data: DeeplinkResponse) => void) => {
		remove(): void;
	};
} {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"onDeeplinkReceived" in obj &&
		typeof (obj as any).onDeeplinkReceived === "function" &&
		typeof (obj as any).onDeeplinkReceived(() => {}).remove === "function"
	);
}

function hasAddDeeplinkListener(obj: unknown): obj is { addDeeplinkListener: () => void } {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"addDeeplinkListener" in obj &&
		typeof (obj as any).addDeeplinkListener === "function"
	);
}

let SuperBoardWrapperModule: SuperBoardWrapperInterface;

if (isTurboModuleEnabled) {
	try {
		// Try to import Turbo Module
		SuperBoardWrapperModule = require("./NativeSuperBoardWrapper").default;
		log("info", "Turbo modules enabled - using Turbo modules");
	} catch {
		log("info", "Turbo modules enabled but not available - falling back to legacy bridge");
		SuperBoardWrapperModule = NativeModules.SuperBoardWrapper;
	}
} else {
	// Use legacy bridge
	SuperBoardWrapperModule = NativeModules.SuperBoardWrapper;
	log("info", "Turbo modules disabled - falling back to legacy bridge");
}

if (!SuperBoardWrapperModule) {
	log("error", LINKING_ERROR);
	throw new Error(LINKING_ERROR);
}

class SuperBoardWrapper implements SuperBoardWrapperInterface {
	private module: SuperBoardWrapperInterface;
	private listeners: Set<(data: DeeplinkResponse) => void> = new Set();

	constructor() {
		this.module = SuperBoardWrapperModule;

		if (hasAddDeeplinkListener(this.module)) {
			log("info", "Has native addDeeplinkListener - registering addDeeplinkListener");
			this.module.addDeeplinkListener();
		}

		if (NativeModules.SuperBoardWrapper) {
			log("info", "Has NativeModules.SuperBoardWrapper - registering adding event listener");
			const emitter = new NativeEventEmitter(NativeModules.SuperBoardWrapper);
			emitter.addListener("onSuperBoardDeeplinkReceived", (data) => {
				this.triggerDeeplink(data);
			});
		}
	}

	/**
	 * Set user identifier
	 * @param identifier - User identifier
	 */
	setIdentifier(identifier?: string): void {
		this.module.setIdentifier(identifier);
	}

	/**
	 * Set push token
	 * @param pushToken - Push notification token
	 */
	setPushToken(pushToken?: string): void {
		this.module.setPushToken(pushToken);
	}

	/**
	 * Set user attributes
	 * @param attributes - User attributes
	 */
	setAttributes(attributes?: { [key: string]: Any }): void {
		this.module.setAttributes(attributes);
	}

	/**
	 * Enable/disable SDK
	 * @param enabled - SDK enabled state
	 */
	setSDK(enabled: boolean): void {
		this.module.setSDK(enabled);
	}

	/**
	 * Set debug level
	 * @param level - Debug level
	 */
	setDebug(level: LogLevel): void {
		this.module.setDebug(level);
	}

	/**
	 * Generate a deep link
	 * @param title - Link title
	 * @param subtitle - Link subtitle
	 * @param imageURL - Image URL
	 * @param data - Additional data
	 * @param tags - Tags array
	 * @param customRedirects - Custom redirects configuration
	 * @param showPreview - Show preview flag
	 * @returns Generated link
	 */
	async generateLink(
		title?: string,
		subtitle?: string,
		imageURL?: string,
		data?: { [key: string]: Any },
		tags?: Array<Any>,
		customRedirects?: CustomRedirects,
		showPreviewIos?: boolean,
		showPreviewAndroid?: boolean,
		tracking?: Tracking,
	): Promise<string> {
		try {
			const link = await this.module.generateLink(
				title,
				subtitle,
				imageURL,
				data,
				tags,
				customRedirects,
				showPreviewIos,
				showPreviewAndroid,
				tracking,
			);
			return link;
		} catch (error) {
			throw new Error(`Failed to generate link: ${(error as Error).message}`);
		}
	}

	/**
	 * Display messages
	 */
	async displayMessages(): Promise<void> {
		try {
			await this.module.displayMessages();
		} catch (error) {
			throw new Error(`Failed to display messages: ${(error as Error).message}`);
		}
	}

	/**
	 * Get number of unread messages
	 * @returns Number of unread messages
	 */
	async numberOfUnreadMessages(): Promise<number> {
		try {
			const count = await this.module.numberOfUnreadMessages();
			return count;
		} catch (error) {
			throw new Error(`Failed to get unread messages count: ${(error as Error).message}`);
		}
	}

	async logInAppPurchase(transactionId: string): Promise<boolean> {
		try {
			return await this.module.logInAppPurchase(transactionId);
		} catch (error) {
			throw new Error(`Failed to log in-app purchase: ${(error as Error).message}`);
		}
	}

	async logCustomPurchase(
		type: TransactionType,
		priceInCents: number,
		currency: string,
		productId: string,
		startDate?: string,
	): Promise<boolean> {
		try {
			return await this.module.logCustomPurchase(
				type,
				priceInCents,
				currency,
				productId,
				startDate,
			);
		} catch (error) {
			throw new Error(`Failed to log custom purchase: ${(error as Error).message}`);
		}
	}

	/**
	 * Event emitter for deeplink received events
	 * @returns Event emitter with addListener and removeAllListeners methods
	 */
	onDeeplinkReceived(callback: (data: DeeplinkResponse) => void) {
		log("info", "Registering deeplink received");
		if (hasOnDeeplinkReceived(this.module)) {
			log("info", "Using turbo module - using onDeeplinkReceived");
			const sub = this.module.onDeeplinkReceived(callback);
			return { remove: () => sub.remove() };
		}

		log("info", "Bridge mode - registering callback");
		this.listeners.add(callback);
		this.markReadyToHandleDeeplinks();

		return {
			remove: () => {
				this.listeners.delete(callback);
			},
		};
	}

	markReadyToHandleDeeplinks(): void {
		this.module.markReadyToHandleDeeplinks();
	}

	// Trigger all listeners when a deeplink is received
	private triggerDeeplink(data: DeeplinkResponse) {
		for (const cb of this.listeners) {
			cb(data);
		}
	}
}

// Export singleton instance
export default new SuperBoardWrapper();

// Also export class for advanced usage
export { SuperBoardWrapper };

// Export types for TypeScript users
export type {
	LogLevel,
	AnyPrimitive,
	Any,
	DeeplinkResponse,
	CustomLinkRedirect,
	CustomRedirects,
	TransactionType,
} from "./NativeSuperBoardWrapper";
