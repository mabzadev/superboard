import Foundation
import UIKit

struct ButtonAction {
    let title: String
    let action: SuperBoardEmptyClosure?
}

class AlertHelper {

    static func showGenericError() {
        dismissAllNotifications()
        displayMessageOnTopOfEverything("Something went wrong, please try again!", title: "Ooops!")
    }

    static func displayMessageOnTopOfEverything(_ message: String, title: String, completion: SuperBoardEmptyClosure? = nil) {
        let alertController = UIAlertController(title: title, message: message, preferredStyle: .alert)
        let action = UIAlertAction(title: "OK", style: .cancel) { _ in
            alertController.xxx_window?.isHidden = true
            alertController.xxx_window = nil

            completion?()
        }

        alertController.addAction(action)
        alertController.showOnANewWindow()
    }

    static func displayMessageOnTopOfEverythingWithOptions(_ message: String, title: String, buttons: [ButtonAction]) {
        let alertController = UIAlertController(title: title, message: message, preferredStyle: .alert)

        for button in buttons {
            let action = UIAlertAction(title: button.title, style: .default) { _ in
                removeAlert(alertController)
                button.action?()
            }

            alertController.addAction(action)
        }

        alertController.showOnANewWindow()
    }

    static func removeAlert(_ alertController: UIAlertController) {
        alertController.xxx_window?.isHidden = true
        alertController.xxx_window = nil
    }

    static func dismissAllNotifications() {
        guard let rootViewController = Presenter.getKeyWindow()?.rootViewController else {
            return
        }

        dismissAlerts(in: rootViewController)
    }

    private static func dismissAlerts(in viewController: UIViewController) {
        if let alertController = viewController as? UIAlertController {
            alertController.dismiss(animated: true, completion: nil)
        }

        for childViewController in viewController.children {
            dismissAlerts(in: childViewController)
        }

        if let presentedViewController = viewController.presentedViewController {
            dismissAlerts(in: presentedViewController)
        }
    }
}
