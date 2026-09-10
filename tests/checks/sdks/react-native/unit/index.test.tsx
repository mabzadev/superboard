const mockSetIdentifier = jest.fn();
const mockSetPushToken = jest.fn();
const mockSetAttributes = jest.fn();
const mockSetSDK = jest.fn();
const mockSetDebug = jest.fn();
const mockGenerateLink = jest.fn();
const mockDisplayMessages = jest.fn();
const mockNumberOfUnreadMessages = jest.fn();
const mockMarkReadyToHandleDeeplinks = jest.fn();
const mockLogInAppPurchase = jest.fn();
const mockLogCustomPurchase = jest.fn();
const mockAddListener = jest.fn(() => ({ remove: jest.fn() }));
const storeParityFixture = require("../../../../fixtures/contracts/emdash-store-parity/v1.json");

jest.mock("react-native", () => {
	const addListenerMock = jest.fn((_event: string, callback: (data: unknown) => void) => {
		// Store callback so we can trigger it in tests
		(addListenerMock as any).__lastCallback = callback;
		return { remove: jest.fn() };
	});

	return {
		NativeModules: {
			SuperBoardWrapper: {
				setIdentifier: mockSetIdentifier,
				setPushToken: mockSetPushToken,
				setAttributes: mockSetAttributes,
				setSDK: mockSetSDK,
				setDebug: mockSetDebug,
				generateLink: mockGenerateLink,
				displayMessages: mockDisplayMessages,
				numberOfUnreadMessages: mockNumberOfUnreadMessages,
				markReadyToHandleDeeplinks: mockMarkReadyToHandleDeeplinks,
				logInAppPurchase: mockLogInAppPurchase,
				logCustomPurchase: mockLogCustomPurchase,
				addListener: mockAddListener,
				removeListeners: jest.fn(),
			},
		},
		NativeEventEmitter: jest.fn(() => ({
			addListener: addListenerMock,
		})),
	};
});

// Ensure legacy bridge path (not turbo)
(global as any).RN$Bridgeless = false;

// Must import after mocks are set up
let SuperBoard: typeof import("../../../../../sdks/react-native/src/index").default;
let SuperBoardWrapper: typeof import("../../../../../sdks/react-native/src/index").SuperBoardWrapper;

beforeAll(() => {
	const mod = require("../../../../../sdks/react-native/src/index");
	SuperBoard = mod.default;
	SuperBoardWrapper = mod.SuperBoardWrapper;
});

beforeEach(() => {
	jest.clearAllMocks();
});

describe("SuperBoardWrapper", () => {
	it("passes the shared EmDash Store fixture through the native SDK bridge", () => {
		SuperBoard.setIdentifier(storeParityFixture.application_user.identifier);
		SuperBoard.setAttributes(storeParityFixture.application_user.attributes);
		expect(mockSetIdentifier).toHaveBeenCalledWith("user-1");
		expect(mockSetAttributes).toHaveBeenCalledWith({ active: true });
	});

	describe("exports", () => {
		it("exports a default singleton instance", () => {
			expect(SuperBoard).toBeDefined();
		});

		it("exports the SuperBoardWrapper class", () => {
			expect(SuperBoardWrapper).toBeDefined();
		});
	});

	describe("setIdentifier", () => {
		it("forwards identifier to native module", () => {
			SuperBoard.setIdentifier("user-123");
			expect(mockSetIdentifier).toHaveBeenCalledWith("user-123");
		});

		it("forwards undefined when no identifier provided", () => {
			SuperBoard.setIdentifier();
			expect(mockSetIdentifier).toHaveBeenCalledWith(undefined);
		});
	});

	describe("setPushToken", () => {
		it("forwards push token to native module", () => {
			SuperBoard.setPushToken("fcm-token-abc");
			expect(mockSetPushToken).toHaveBeenCalledWith("fcm-token-abc");
		});

		it("forwards undefined when no token provided", () => {
			SuperBoard.setPushToken();
			expect(mockSetPushToken).toHaveBeenCalledWith(undefined);
		});
	});

	describe("setAttributes", () => {
		it("forwards attributes to native module", () => {
			const attrs = { name: "John", age: 30, premium: true };
			SuperBoard.setAttributes(attrs);
			expect(mockSetAttributes).toHaveBeenCalledWith(attrs);
		});

		it("handles array values in attributes", () => {
			const attrs = { tags: ["a", "b", "c"] };
			SuperBoard.setAttributes(attrs);
			expect(mockSetAttributes).toHaveBeenCalledWith(attrs);
		});

		it("forwards undefined when no attributes provided", () => {
			SuperBoard.setAttributes();
			expect(mockSetAttributes).toHaveBeenCalledWith(undefined);
		});
	});

	describe("setSDK", () => {
		it("enables SDK", () => {
			SuperBoard.setSDK(true);
			expect(mockSetSDK).toHaveBeenCalledWith(true);
		});

		it("disables SDK", () => {
			SuperBoard.setSDK(false);
			expect(mockSetSDK).toHaveBeenCalledWith(false);
		});
	});

	describe("setDebug", () => {
		it("sets info log level", () => {
			SuperBoard.setDebug("info");
			expect(mockSetDebug).toHaveBeenCalledWith("info");
		});

		it("sets error log level", () => {
			SuperBoard.setDebug("error");
			expect(mockSetDebug).toHaveBeenCalledWith("error");
		});
	});

	describe("generateLink", () => {
		it("generates a link with all parameters", async () => {
			mockGenerateLink.mockResolvedValue("https://github.com/mabzadev/superboard-platform/abc123");

			const customRedirects = {
				ios: { link: "https://ios.example.com", open_if_app_installed: true },
				android: {
					link: "https://android.example.com",
					open_if_app_installed: true,
				},
				desktop: {
					link: "https://desktop.example.com",
					open_if_app_installed: false,
				},
			};
			const tracking = {
				utm_medium: "social",
				utm_source: "twitter",
				utm_campaign: "launch",
			};

			const link = await SuperBoard.generateLink(
				"Title",
				"Subtitle",
				"https://img.example.com/pic.png",
				{ key: "value" },
				["tag1", "tag2"],
				customRedirects,
				true,
				false,
				tracking,
			);

			expect(link).toBe("https://github.com/mabzadev/superboard-platform/abc123");
			expect(mockGenerateLink).toHaveBeenCalledWith(
				"Title",
				"Subtitle",
				"https://img.example.com/pic.png",
				{ key: "value" },
				["tag1", "tag2"],
				customRedirects,
				true,
				false,
				tracking,
			);
		});

		it("generates a link with minimal parameters", async () => {
			mockGenerateLink.mockResolvedValue("https://github.com/mabzadev/superboard-platform/minimal");

			const link = await SuperBoard.generateLink("Title");
			expect(link).toBe("https://github.com/mabzadev/superboard-platform/minimal");
		});

		it("throws on native error", async () => {
			mockGenerateLink.mockRejectedValue(new Error("Network error"));

			await expect(SuperBoard.generateLink("Title")).rejects.toThrow(
				"Failed to generate link: Network error",
			);
		});
	});

	describe("displayMessages", () => {
		it("calls native displayMessages", async () => {
			mockDisplayMessages.mockResolvedValue(undefined);
			await SuperBoard.displayMessages();
			expect(mockDisplayMessages).toHaveBeenCalled();
		});

		it("throws on native error", async () => {
			mockDisplayMessages.mockRejectedValue(new Error("Display failed"));

			await expect(SuperBoard.displayMessages()).rejects.toThrow(
				"Failed to display messages: Display failed",
			);
		});
	});

	describe("numberOfUnreadMessages", () => {
		it("returns unread count", async () => {
			mockNumberOfUnreadMessages.mockResolvedValue(5);

			const count = await SuperBoard.numberOfUnreadMessages();
			expect(count).toBe(5);
		});

		it("returns zero when no unread messages", async () => {
			mockNumberOfUnreadMessages.mockResolvedValue(0);

			const count = await SuperBoard.numberOfUnreadMessages();
			expect(count).toBe(0);
		});

		it("throws on native error", async () => {
			mockNumberOfUnreadMessages.mockRejectedValue(new Error("Fetch failed"));

			await expect(SuperBoard.numberOfUnreadMessages()).rejects.toThrow(
				"Failed to get unread messages count: Fetch failed",
			);
		});
	});

	describe("onDeeplinkReceived", () => {
		it("registers a listener and returns remove handle", () => {
			const callback = jest.fn();
			const subscription = SuperBoard.onDeeplinkReceived(callback);

			expect(subscription).toBeDefined();
			expect(typeof subscription.remove).toBe("function");
		});

		it("calls markReadyToHandleDeeplinks on registration", () => {
			const callback = jest.fn();
			SuperBoard.onDeeplinkReceived(callback);

			expect(mockMarkReadyToHandleDeeplinks).toHaveBeenCalled();
		});

		it("triggers callback when deeplink event is emitted", () => {
			const callback = jest.fn();
			SuperBoard.onDeeplinkReceived(callback);

			const deeplinkData = {
				link: "https://github.com/mabzadev/superboard-platform/deep",
				data: { screen: "profile" },
			};
			// Simulate the NativeEventEmitter firing — triggerDeeplink fans out to listeners
			(SuperBoard as any).triggerDeeplink(deeplinkData);

			expect(callback).toHaveBeenCalledWith(deeplinkData);
		});

		it("stops receiving events after remove is called", () => {
			const callback = jest.fn();
			const subscription = SuperBoard.onDeeplinkReceived(callback);
			subscription.remove();

			const deeplinkData = {
				link: "https://github.com/mabzadev/superboard-platform/after-remove",
			};
			// Trigger on any remaining listeners — callback should not be in set
			(SuperBoard as any).triggerDeeplink(deeplinkData);

			expect(callback).not.toHaveBeenCalledWith(deeplinkData);
		});

		it("supports multiple concurrent listeners", () => {
			const cb1 = jest.fn();
			const cb2 = jest.fn();
			SuperBoard.onDeeplinkReceived(cb1);
			SuperBoard.onDeeplinkReceived(cb2);

			const deeplinkData = {
				link: "https://github.com/mabzadev/superboard-platform/multi",
			};
			(SuperBoard as any).triggerDeeplink(deeplinkData);

			expect(cb1).toHaveBeenCalledWith(deeplinkData);
			expect(cb2).toHaveBeenCalledWith(deeplinkData);
		});

		it("only removes the specific listener on remove", () => {
			const cb1 = jest.fn();
			const cb2 = jest.fn();
			const sub1 = SuperBoard.onDeeplinkReceived(cb1);
			SuperBoard.onDeeplinkReceived(cb2);

			sub1.remove();

			const deeplinkData = {
				link: "https://github.com/mabzadev/superboard-platform/partial",
			};
			(SuperBoard as any).triggerDeeplink(deeplinkData);

			expect(cb1).not.toHaveBeenCalled();
			expect(cb2).toHaveBeenCalledWith(deeplinkData);
		});
	});

	describe("markReadyToHandleDeeplinks", () => {
		it("forwards to native module", () => {
			SuperBoard.markReadyToHandleDeeplinks();
			expect(mockMarkReadyToHandleDeeplinks).toHaveBeenCalled();
		});
	});

	describe("logInAppPurchase", () => {
		it("resolves with true on success", async () => {
			mockLogInAppPurchase.mockResolvedValue(true);
			const result = await SuperBoard.logInAppPurchase("12345");
			expect(result).toBe(true);
			expect(mockLogInAppPurchase).toHaveBeenCalledWith("12345");
		});

		it("throws on native error", async () => {
			mockLogInAppPurchase.mockRejectedValue(new Error("Purchase failed"));
			await expect(SuperBoard.logInAppPurchase("12345")).rejects.toThrow(
				"Failed to log in-app purchase: Purchase failed",
			);
		});
	});

	describe("logCustomPurchase", () => {
		it("resolves with true on success", async () => {
			mockLogCustomPurchase.mockResolvedValue(true);
			const result = await SuperBoard.logCustomPurchase("buy", 999, "USD", "premium_monthly");
			expect(result).toBe(true);
			expect(mockLogCustomPurchase).toHaveBeenCalledWith(
				"buy",
				999,
				"USD",
				"premium_monthly",
				undefined,
			);
		});

		it("passes startDate when provided", async () => {
			mockLogCustomPurchase.mockResolvedValue(true);
			await SuperBoard.logCustomPurchase(
				"buy",
				999,
				"USD",
				"premium_monthly",
				"2026-01-15T00:00:00Z",
			);
			expect(mockLogCustomPurchase).toHaveBeenCalledWith(
				"buy",
				999,
				"USD",
				"premium_monthly",
				"2026-01-15T00:00:00Z",
			);
		});

		it("supports cancel type", async () => {
			mockLogCustomPurchase.mockResolvedValue(true);
			await SuperBoard.logCustomPurchase("cancel", 999, "USD", "premium_monthly");
			expect(mockLogCustomPurchase).toHaveBeenCalledWith(
				"cancel",
				999,
				"USD",
				"premium_monthly",
				undefined,
			);
		});

		it("supports refund type", async () => {
			mockLogCustomPurchase.mockResolvedValue(true);
			await SuperBoard.logCustomPurchase("refund", 999, "USD", "premium_monthly");
			expect(mockLogCustomPurchase).toHaveBeenCalledWith(
				"refund",
				999,
				"USD",
				"premium_monthly",
				undefined,
			);
		});

		it("throws on native error", async () => {
			mockLogCustomPurchase.mockRejectedValue(new Error("Track failed"));
			await expect(SuperBoard.logCustomPurchase("buy", 999, "USD", "product")).rejects.toThrow(
				"Failed to log custom purchase: Track failed",
			);
		});
	});
});
