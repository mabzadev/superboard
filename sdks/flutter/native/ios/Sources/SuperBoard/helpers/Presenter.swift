import UIKit

class DismissalDelegate: NSObject, UIAdaptivePresentationControllerDelegate {
    static let shared = DismissalDelegate()

    var completion: SuperBoardEmptyClosure?

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        let block = completion
        completion = nil
        block?()
    }

    func viewControllerDidDismiss() {
        let block = completion
        completion = nil
        block?()
    }
}

class Presenter {

    static func getPresentedViewControllers<T: UIViewController>(ofType type: T.Type) -> [T] {
        var matchingViewControllers = [T]()

        var viewController = getTopViewController()

        while let presentedVC = viewController?.presentedViewController {
            if let matchingVC = presentedVC as? T {
                matchingViewControllers.append(matchingVC)
            }
            viewController = presentedVC
        }

        return matchingViewControllers
    }

    static func presentOnTop(_ viewController: UIViewController, animated: Bool = true, completion: (() -> Void)? = nil) {
        if let topViewController = getTopViewController() {
            topViewController.present(viewController, animated: animated, completion: completion)
        }
    }

    private static func getTopViewController() -> UIViewController? {
        let keyWindow = getKeyWindow()

        var topController = keyWindow?.rootViewController

        while let presentedViewController = topController?.presentedViewController {
            topController = presentedViewController
        }

        return topController
    }

    static func getKeyWindow() -> UIWindow? {
        if #available(iOS 15, *) {
            return UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .filter { $0.activationState == .foregroundActive }
                .first?.keyWindow
        }

        return UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
            .first?.windows.first { $0.isKeyWindow }
    }
}
