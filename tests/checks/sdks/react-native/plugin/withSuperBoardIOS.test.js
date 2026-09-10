const {
	addSuperBoardImport,
	addSuperBoardConfiguration,
	addSuperBoardUniversalLinkHandler,
	addSuperBoardURLHandler,
	addSuperBoardPodDependency,
} = require("../../../../../sdks/react-native/plugin/withSuperBoardIOS");
const nativeContract = require("../../../../../sdks/react-native/plugin/native-contract.json");

const IOS_POD = `pod '${nativeContract.ios.packageName}'`;
const IOS_PODSPEC_DEPENDENCY = `${IOS_POD}, :podspec => '${nativeContract.ios.podspecUrl}'`;

const SAMPLE_PODFILE = `platform :ios, min_ios_version_supported

target 'MyApp' do
  config = use_native_modules!
end
`;

const SAMPLE_APP_DELEGATE = `import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: RCTAppDelegate {
  override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil) -> Bool {
    self.moduleName = "MyApp"
    self.dependencyProvider = RCTAppDependencyProvider()
    self.initialProps = [:]

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
  }
}`;

describe("withSuperBoardIOS - AppDelegate transforms", () => {
	describe("addSuperBoardImport", () => {
		it("adds import SuperBoard after last import", () => {
			const result = addSuperBoardImport(SAMPLE_APP_DELEGATE);
			expect(result).toContain("import SuperBoard");
			// Should be after ReactAppDependencyProvider import
			const superboardIndex = result.indexOf("import SuperBoard");
			const depProviderIndex = result.indexOf("import ReactAppDependencyProvider");
			expect(superboardIndex).toBeGreaterThan(depProviderIndex);
		});

		it("does not duplicate import", () => {
			const first = addSuperBoardImport(SAMPLE_APP_DELEGATE);
			const second = addSuperBoardImport(first);
			const count = (second.match(/import SuperBoard/g) || []).length;
			expect(count).toBe(1);
		});
	});

	describe("addSuperBoardConfiguration", () => {
		it("adds SuperBoard.configure synchronously after super.application returns", () => {
			const result = addSuperBoardConfiguration(SAMPLE_APP_DELEGATE, {
				apiKey: "test-key-123",
				useTestEnvironment: true,
			});
			expect(result).toContain(
				'SuperBoard.configure(APIKey: "test-key-123", useTestEnvironment: true, delegate: nil)',
			);
			// Configure must run AFTER super.application(_:didFinishLaunchingWithOptions:)
			// returns (the dev-launcher window setup happens inside super; running
			// configure before super interrupts it and produces a black screen on
			// Expo SDK 54). It must also be SYNCHRONOUS — deferring with
			// DispatchQueue.main.async breaks the SuperBoard SDK's background NSURLSession
			// and `generateLink` calls hang forever.
			const superCallIndex = result.indexOf(
				"let didFinishLaunchingResult = super.application(application, didFinishLaunchingWithOptions: launchOptions)",
			);
			const configIndex = result.indexOf("SuperBoard.configure");
			const returnIndex = result.indexOf("return didFinishLaunchingResult");
			expect(superCallIndex).toBeGreaterThan(-1);
			expect(configIndex).toBeGreaterThan(superCallIndex);
			expect(returnIndex).toBeGreaterThan(configIndex);
			expect(result).not.toContain("DispatchQueue.main.async");
		});

		it("uses false for production environment", () => {
			const result = addSuperBoardConfiguration(SAMPLE_APP_DELEGATE, {
				apiKey: "prod-key",
				useTestEnvironment: false,
			});
			expect(result).toContain("useTestEnvironment: false");
		});

		it("adds baseURL when provided", () => {
			const result = addSuperBoardConfiguration(SAMPLE_APP_DELEGATE, {
				apiKey: "key",
				useTestEnvironment: false,
				baseURL: "https://custom.example.com",
			});
			expect(result).toContain('baseURL: "https://custom.example.com"');
		});

		it("omits baseURL when not provided", () => {
			const result = addSuperBoardConfiguration(SAMPLE_APP_DELEGATE, {
				apiKey: "key",
				useTestEnvironment: false,
				baseURL: null,
			});
			expect(result).not.toContain("baseURL");
		});

		it("does not duplicate configuration", () => {
			const first = addSuperBoardConfiguration(SAMPLE_APP_DELEGATE, {
				apiKey: "key",
				useTestEnvironment: false,
			});
			const second = addSuperBoardConfiguration(first, {
				apiKey: "key",
				useTestEnvironment: false,
			});
			const count = (second.match(/SuperBoard\.configure/g) || []).length;
			expect(count).toBe(1);
		});
	});

	describe("addSuperBoardUniversalLinkHandler", () => {
		it("adds continue userActivity handler", () => {
			const result = addSuperBoardUniversalLinkHandler(SAMPLE_APP_DELEGATE);
			expect(result).toContain("continue userActivity: NSUserActivity");
			expect(result).toContain("SuperBoard.handleAppDelegate(continue: userActivity");
		});

		it("does not duplicate handler", () => {
			const first = addSuperBoardUniversalLinkHandler(SAMPLE_APP_DELEGATE);
			const second = addSuperBoardUniversalLinkHandler(first);
			const count = (second.match(/SuperBoard\.handleAppDelegate\(continue:/g) || []).length;
			expect(count).toBe(1);
		});
	});

	describe("addSuperBoardURLHandler", () => {
		it("adds open url handler", () => {
			const result = addSuperBoardURLHandler(SAMPLE_APP_DELEGATE);
			expect(result).toContain("open url: URL");
			expect(result).toContain("SuperBoard.handleAppDelegate(open: url");
		});

		it("does not duplicate handler", () => {
			const first = addSuperBoardURLHandler(SAMPLE_APP_DELEGATE);
			const second = addSuperBoardURLHandler(first);
			const count = (second.match(/SuperBoard\.handleAppDelegate\(open:/g) || []).length;
			expect(count).toBe(1);
		});
	});

	describe("full transform pipeline", () => {
		it("produces valid AppDelegate with all modifications", () => {
			let result = SAMPLE_APP_DELEGATE;
			result = addSuperBoardImport(result);
			result = addSuperBoardConfiguration(result, {
				apiKey: "my-api-key",
				useTestEnvironment: true,
			});
			result = addSuperBoardUniversalLinkHandler(result);
			result = addSuperBoardURLHandler(result);

			expect(result).toContain("import SuperBoard");
			expect(result).toContain('SuperBoard.configure(APIKey: "my-api-key"');
			expect(result).toContain("SuperBoard.handleAppDelegate(continue:");
			expect(result).toContain("SuperBoard.handleAppDelegate(open:");

			// Verify ordering: import -> configure -> handlers
			const importIdx = result.indexOf("import SuperBoard");
			const configIdx = result.indexOf("SuperBoard.configure");
			const continueIdx = result.indexOf("SuperBoard.handleAppDelegate(continue:");
			const openIdx = result.indexOf("SuperBoard.handleAppDelegate(open:");

			expect(importIdx).toBeLessThan(configIdx);
			expect(configIdx).toBeLessThan(continueIdx);
			expect(continueIdx).toBeLessThan(openIdx);
		});

		it("is idempotent when run twice", () => {
			function applyAll(input) {
				let r = input;
				r = addSuperBoardImport(r);
				r = addSuperBoardConfiguration(r, {
					apiKey: "key",
					useTestEnvironment: false,
				});
				r = addSuperBoardUniversalLinkHandler(r);
				r = addSuperBoardURLHandler(r);
				return r;
			}

			const first = applyAll(SAMPLE_APP_DELEGATE);
			const second = applyAll(first);
			expect(first).toBe(second);
		});
	});
});

describe("withSuperBoardIOS - immutable native pod dependency", () => {
	it("injects the catalog SDK tag before React Native autolinking", () => {
		const result = addSuperBoardPodDependency(SAMPLE_PODFILE);
		expect(result).toContain(IOS_PODSPEC_DEPENDENCY);
		expect(result.indexOf(IOS_POD)).toBeLessThan(result.indexOf("use_native_modules!"));
	});

	it("replaces an implicit Trunk pod and remains idempotent", () => {
		const legacy = SAMPLE_PODFILE.replace(
			"config = use_native_modules!",
			"pod 'SuperBoard', '~> 1.0'\n  config = use_native_modules!",
		);
		const first = addSuperBoardPodDependency(legacy);
		const second = addSuperBoardPodDependency(first);
		expect(first).toBe(second);
		expect(first).not.toContain("pod 'SuperBoard', '~> 1.0'");
		expect(first.split(IOS_POD).length - 1).toBe(1);
	});
});
