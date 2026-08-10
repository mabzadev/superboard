export const appDelegateContent = `import UIKit
import SuperBoard

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any] ?) -> Bool {  // Configure the SDK
        SuperBoard.configure(APIKey: "_OPENGROW_API_KEY_", useTestEnvironment: false, delegate: self)
        // Other code
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [: ]) -> Bool {  // Handle URLs
        return SuperBoard.handleAppDelegate(open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping([UIUserActivityRestoring] ?) -> Void) -> Bool {  // Handle URLs
        return SuperBoard.handleAppDelegate(continue: userActivity, restorationHandler: restorationHandler)
    }

}

extension AppDelegate: SuperBoardDelegate {
    func opengrowReceivedPayloadFromDeeplink(link: String?, payload: [String: Any]?) {
        print("Received payload:")
        debugPrint(payload)
    }
}
      
`;

export const sceneDelegateContent = `import SuperBoard
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // ... other code...

        // Initialize SDK
        SuperBoard.configure(APIKey: "_OPENGROW_API_KEY_", useTestEnvironment: false, delegate: self)

        // Handle URL
        SuperBoard.handleSceneDelegate(options: connectionOptions)
    }


    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        // Handle URL
        SuperBoard.handleSceneDelegate(continue: userActivity)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set < UIOpenURLContext >) {
        // Handle URL
        SuperBoard.handleSceneDelegate(openURLContexts: URLContexts)
    }
}

extension SceneDelegate: SuperBoardDelegate {
    func opengrowReceivedPayloadFromDeeplink(link: String?, payload: [String: Any]?) {
        print("Received payload:")
        debugPrint(payload)
    }
}
`;

export const reactNativeContent = `import UIKit
import SuperBoard

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions, launchOptions: [UIApplication.LaunchOptionsKey: Any] ?) -> Bool {

        // Configure the SDK
        SuperBoard.configure(APIKey: "_OPENGROW_API_KEY_", useTestEnvironment: false, delegate: self)
        // Other code
        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [: ]) -> Bool {

        // Handle URLs
        return SuperBoard.handleAppDelegate(open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping([UIUserActivityRestoring] ?) -> Void) -> Bool {

        // Handle URLs
        return SuperBoard.handleAppDelegate(continue: userActivity, restorationHandler: restorationHandler)
    }

}
`;
