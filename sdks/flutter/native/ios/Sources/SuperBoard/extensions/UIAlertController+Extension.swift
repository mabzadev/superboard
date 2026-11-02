import Foundation
import UIKit

fileprivate class AlertContainerViewController: UIViewController {
    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }
}

extension UIAlertController {

    private struct AssociatedKeys {
        static var activityIndicator = "xxx_window"
    }

    var xxx_window: UIWindow? {
        get {
            return objc_getAssociatedObject(self, &AssociatedKeys.activityIndicator) as? UIWindow
        }
        set {
            objc_setAssociatedObject(
                self,
                &AssociatedKeys.activityIndicator,
                newValue,
                .OBJC_ASSOCIATION_RETAIN_NONATOMIC
            )
        }
    }

    func showOnANewWindow() {
        if let scene = UIApplication.shared.connectedScenes
            .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
            xxx_window = UIWindow(windowScene: scene)

            if let topWindow = scene.windows.first(where: { $0.isKeyWindow }) {
                xxx_window?.windowLevel = topWindow.windowLevel + 1
            }
        } else {
            xxx_window = UIWindow(frame: UIScreen.main.bounds)
        }

        xxx_window?.rootViewController = AlertContainerViewController()
        xxx_window?.makeKeyAndVisible()
        xxx_window?.rootViewController?.present(self, animated: true, completion: nil)
    }
}
