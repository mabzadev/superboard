export const appDelegateContent = `import UIKit
import OpenGrow

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any] ?) -> Bool {  // Configure the SDK
        OpenGrow.configure(APIKey: "_OPENGROW_API_KEY_", useTestEnvironment: false, delegate: self)
        // Other code
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [: ]) -> Bool {  // Handle URLs
        return OpenGrow.handleAppDelegate(open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping([UIUserActivityRestoring] ?) -> Void) -> Bool {  // Handle URLs
        return OpenGrow.handleAppDelegate(continue: userActivity, restorationHandler: restorationHandler)
    }

}

extension AppDelegate: OpenGrowDelegate {
    func opengrowReceivedPayloadFromDeeplink(link: String?, payload: [String: Any]?) {
        print("Received payload:")
        debugPrint(payload)
    }
}
      
`;

export const sceneDelegateContent = `import OpenGrow
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // ... other code...

        // Initialize SDK
        OpenGrow.configure(APIKey: "_OPENGROW_API_KEY_", useTestEnvironment: false, delegate: self)

        // Handle URL
        OpenGrow.handleSceneDelegate(options: connectionOptions)
    }


    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        // Handle URL
        OpenGrow.handleSceneDelegate(continue: userActivity)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set < UIOpenURLContext >) {
        // Handle URL
        OpenGrow.handleSceneDelegate(openURLContexts: URLContexts)
    }
}

extension SceneDelegate: OpenGrowDelegate {
    func opengrowReceivedPayloadFromDeeplink(link: String?, payload: [String: Any]?) {
        print("Received payload:")
        debugPrint(payload)
    }
}
`;

export const reactNativeContent = `import UIKit
import OpenGrow

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions, launchOptions: [UIApplication.LaunchOptionsKey: Any] ?) -> Bool {

        // Configure the SDK
        OpenGrow.configure(APIKey: "_OPENGROW_API_KEY_", useTestEnvironment: false, delegate: self)
        // Other code
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [: ]) -> Bool {

        // Handle URLs
        return OpenGrow.handleAppDelegate(open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping([UIUserActivityRestoring] ?) -> Void) -> Bool {

        // Handle URLs
        return OpenGrow.handleAppDelegate(continue: userActivity, restorationHandler: restorationHandler)
    }

}
`;
