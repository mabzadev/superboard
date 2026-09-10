import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import SuperBoard

@main
class AppDelegate: RCTAppDelegate {
  override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil) -> Bool {
    self.moduleName = "SuperBoardWrapperExample"
    self.dependencyProvider = RCTAppDependencyProvider()

    // You can add your custom initial props in the dictionary below.
    // They will be passed down to the ViewController used by React Native.
    self.initialProps = [:]

    // TODO: Replace with your own API Key
    guard let apiKey = Bundle.main.object(forInfoDictionaryKey: "SuperBoardApiKey") as? String,
          !apiKey.isEmpty else {
      fatalError("Set SuperBoardApiKey in the local, untracked Info.plist configuration")
    }
    SuperBoard.configure(APIKey: apiKey, useTestEnvironment: true, delegate: nil)
    SuperBoard.setDebug(level: .info)

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
  
  // Handle universal link continuation
  override func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    return SuperBoard.handleAppDelegate(continue: userActivity, restorationHandler: restorationHandler)
  }

  // Handle URI opening
  override func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey : Any] = [:]) -> Bool {
      return SuperBoard.handleAppDelegate(open: url, options: options)
  }
}
