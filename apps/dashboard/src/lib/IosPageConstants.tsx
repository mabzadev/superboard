export const appDelegateContent = `import UIKit
import Grovs

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any] ?) -> Bool {  // Configure the SDK
        Grovs.configure(APIKey: "_GROVS_API_KEY_", useTestEnvironment: false, delegate: self)
        // Other code
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [: ]) -> Bool {  // Handle URLs
        return Grovs.handleAppDelegate(open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping([UIUserActivityRestoring] ?) -> Void) -> Bool {  // Handle URLs
        return Grovs.handleAppDelegate(continue: userActivity, restorationHandler: restorationHandler)
    }

}

extension AppDelegate: GrovsDelegate {
    func grovsReceivedPayloadFromDeeplink(link: String?, payload: [String: Any]?) {
        print("Received payload:")
        debugPrint(payload)
    }
}
      
`;

export const sceneDelegateContent = `import Grovs
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // ... other code...

        // Initialize SDK
        Grovs.configure(APIKey: "_GROVS_API_KEY_", useTestEnvironment: false, delegate: self)

        // Handle URL
        Grovs.handleSceneDelegate(options: connectionOptions)
    }


    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        // Handle URL
        Grovs.handleSceneDelegate(continue: userActivity)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set < UIOpenURLContext >) {
        // Handle URL
        Grovs.handleSceneDelegate(openURLContexts: URLContexts)
    }
}

extension SceneDelegate: GrovsDelegate {
    func grovsReceivedPayloadFromDeeplink(link: String?, payload: [String: Any]?) {
        print("Received payload:")
        debugPrint(payload)
    }
}
`;

export const reactNativeContent = `import UIKit
import Grovs

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions, launchOptions: [UIApplication.LaunchOptionsKey: Any] ?) -> Bool {

        // Configure the SDK
        Grovs.configure(APIKey: "_GROVS_API_KEY_", useTestEnvironment: false, delegate: self)
        // Other code
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [: ]) -> Bool {

        // Handle URLs
        return Grovs.handleAppDelegate(open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping([UIUserActivityRestoring] ?) -> Void) -> Bool {

        // Handle URLs
        return Grovs.handleAppDelegate(continue: userActivity, restorationHandler: restorationHandler)
    }

}
`;
