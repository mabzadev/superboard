const {
  addOpenGrowImport,
  addOpenGrowConfiguration,
  addOpenGrowUniversalLinkHandler,
  addOpenGrowURLHandler,
  addOpenGrowPodDependency,
} = require('../withOpenGrowIOS');
const nativeContract = require('../native-contract.json');

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

describe('withOpenGrowIOS - AppDelegate transforms', () => {
  describe('addOpenGrowImport', () => {
    it('adds import OpenGrow after last import', () => {
      const result = addOpenGrowImport(SAMPLE_APP_DELEGATE);
      expect(result).toContain('import OpenGrow');
      // Should be after ReactAppDependencyProvider import
      const opengrowIndex = result.indexOf('import OpenGrow');
      const depProviderIndex = result.indexOf(
        'import ReactAppDependencyProvider'
      );
      expect(opengrowIndex).toBeGreaterThan(depProviderIndex);
    });

    it('does not duplicate import', () => {
      const first = addOpenGrowImport(SAMPLE_APP_DELEGATE);
      const second = addOpenGrowImport(first);
      const count = (second.match(/import OpenGrow/g) || []).length;
      expect(count).toBe(1);
    });
  });

  describe('addOpenGrowConfiguration', () => {
    it('adds OpenGrow.configure synchronously after super.application returns', () => {
      const result = addOpenGrowConfiguration(SAMPLE_APP_DELEGATE, {
        apiKey: 'test-key-123',
        useTestEnvironment: true,
      });
      expect(result).toContain(
        'OpenGrow.configure(APIKey: "test-key-123", useTestEnvironment: true, delegate: nil)'
      );
      // Configure must run AFTER super.application(_:didFinishLaunchingWithOptions:)
      // returns (the dev-launcher window setup happens inside super; running
      // configure before super interrupts it and produces a black screen on
      // Expo SDK 54). It must also be SYNCHRONOUS — deferring with
      // DispatchQueue.main.async breaks the OpenGrow SDK's background NSURLSession
      // and `generateLink` calls hang forever.
      const superCallIndex = result.indexOf(
        'let didFinishLaunchingResult = super.application(application, didFinishLaunchingWithOptions: launchOptions)'
      );
      const configIndex = result.indexOf('OpenGrow.configure');
      const returnIndex = result.indexOf('return didFinishLaunchingResult');
      expect(superCallIndex).toBeGreaterThan(-1);
      expect(configIndex).toBeGreaterThan(superCallIndex);
      expect(returnIndex).toBeGreaterThan(configIndex);
      expect(result).not.toContain('DispatchQueue.main.async');
    });

    it('uses false for production environment', () => {
      const result = addOpenGrowConfiguration(SAMPLE_APP_DELEGATE, {
        apiKey: 'prod-key',
        useTestEnvironment: false,
      });
      expect(result).toContain('useTestEnvironment: false');
    });

    it('adds baseURL when provided', () => {
      const result = addOpenGrowConfiguration(SAMPLE_APP_DELEGATE, {
        apiKey: 'key',
        useTestEnvironment: false,
        baseURL: 'https://custom.example.com',
      });
      expect(result).toContain('baseURL: "https://custom.example.com"');
    });

    it('omits baseURL when not provided', () => {
      const result = addOpenGrowConfiguration(SAMPLE_APP_DELEGATE, {
        apiKey: 'key',
        useTestEnvironment: false,
        baseURL: null,
      });
      expect(result).not.toContain('baseURL');
    });

    it('does not duplicate configuration', () => {
      const first = addOpenGrowConfiguration(SAMPLE_APP_DELEGATE, {
        apiKey: 'key',
        useTestEnvironment: false,
      });
      const second = addOpenGrowConfiguration(first, {
        apiKey: 'key',
        useTestEnvironment: false,
      });
      const count = (second.match(/OpenGrow\.configure/g) || []).length;
      expect(count).toBe(1);
    });
  });

  describe('addOpenGrowUniversalLinkHandler', () => {
    it('adds continue userActivity handler', () => {
      const result = addOpenGrowUniversalLinkHandler(SAMPLE_APP_DELEGATE);
      expect(result).toContain('continue userActivity: NSUserActivity');
      expect(result).toContain(
        'OpenGrow.handleAppDelegate(continue: userActivity'
      );
    });

    it('does not duplicate handler', () => {
      const first = addOpenGrowUniversalLinkHandler(SAMPLE_APP_DELEGATE);
      const second = addOpenGrowUniversalLinkHandler(first);
      const count = (
        second.match(/OpenGrow\.handleAppDelegate\(continue:/g) || []
      ).length;
      expect(count).toBe(1);
    });
  });

  describe('addOpenGrowURLHandler', () => {
    it('adds open url handler', () => {
      const result = addOpenGrowURLHandler(SAMPLE_APP_DELEGATE);
      expect(result).toContain('open url: URL');
      expect(result).toContain('OpenGrow.handleAppDelegate(open: url');
    });

    it('does not duplicate handler', () => {
      const first = addOpenGrowURLHandler(SAMPLE_APP_DELEGATE);
      const second = addOpenGrowURLHandler(first);
      const count = (second.match(/OpenGrow\.handleAppDelegate\(open:/g) || [])
        .length;
      expect(count).toBe(1);
    });
  });

  describe('full transform pipeline', () => {
    it('produces valid AppDelegate with all modifications', () => {
      let result = SAMPLE_APP_DELEGATE;
      result = addOpenGrowImport(result);
      result = addOpenGrowConfiguration(result, {
        apiKey: 'my-api-key',
        useTestEnvironment: true,
      });
      result = addOpenGrowUniversalLinkHandler(result);
      result = addOpenGrowURLHandler(result);

      expect(result).toContain('import OpenGrow');
      expect(result).toContain('OpenGrow.configure(APIKey: "my-api-key"');
      expect(result).toContain('OpenGrow.handleAppDelegate(continue:');
      expect(result).toContain('OpenGrow.handleAppDelegate(open:');

      // Verify ordering: import -> configure -> handlers
      const importIdx = result.indexOf('import OpenGrow');
      const configIdx = result.indexOf('OpenGrow.configure');
      const continueIdx = result.indexOf(
        'OpenGrow.handleAppDelegate(continue:'
      );
      const openIdx = result.indexOf('OpenGrow.handleAppDelegate(open:');

      expect(importIdx).toBeLessThan(configIdx);
      expect(configIdx).toBeLessThan(continueIdx);
      expect(continueIdx).toBeLessThan(openIdx);
    });

    it('is idempotent when run twice', () => {
      function applyAll(input) {
        let r = input;
        r = addOpenGrowImport(r);
        r = addOpenGrowConfiguration(r, {
          apiKey: 'key',
          useTestEnvironment: false,
        });
        r = addOpenGrowUniversalLinkHandler(r);
        r = addOpenGrowURLHandler(r);
        return r;
      }

      const first = applyAll(SAMPLE_APP_DELEGATE);
      const second = applyAll(first);
      expect(first).toBe(second);
    });
  });
});

describe('withOpenGrowIOS - immutable native pod dependency', () => {
  it('injects the catalog SDK tag before React Native autolinking', () => {
    const result = addOpenGrowPodDependency(SAMPLE_PODFILE);
    expect(result).toContain(IOS_PODSPEC_DEPENDENCY);
    expect(result.indexOf(IOS_POD)).toBeLessThan(
      result.indexOf('use_native_modules!')
    );
  });

  it('replaces an implicit Trunk pod and remains idempotent', () => {
    const legacy = SAMPLE_PODFILE.replace(
      'config = use_native_modules!',
      "pod 'OpenGrow', '~> 1.0'\n  config = use_native_modules!"
    );
    const first = addOpenGrowPodDependency(legacy);
    const second = addOpenGrowPodDependency(first);
    expect(first).toBe(second);
    expect(first).not.toContain("pod 'OpenGrow', '~> 1.0'");
    expect(first.split(IOS_POD).length - 1).toBe(1);
  });
});
