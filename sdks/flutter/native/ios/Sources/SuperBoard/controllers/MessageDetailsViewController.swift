import UIKit
import WebKit

class MessageDetailsViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {

    static func loadVCFromNib() -> MessageDetailsViewController? {
        var vc: MessageDetailsViewController?

#if SWIFT_PACKAGE
        vc = MessageDetailsViewController.init(nibName: "MessageDetailsViewController", bundle: Bundle.module)
#else
        vc = MessageDetailsViewController.init(nibName: "MessageDetailsViewController", bundle: Bundle.framework)
#endif

        return vc
    }

    @IBOutlet weak var activityIndicator: UIActivityIndicatorView!
    @IBOutlet weak var webView: WKWebView!
    @IBOutlet weak var backButton: UIButton!
    @IBOutlet weak var closeButton: UIButton!

    var notification: SuperBoardNotification?
    weak var manager: SuperBoardManager?
    var dismissalDelegate: DismissalDelegate?

    override func viewDidLoad() {
        super.viewDidLoad()

        activityIndicator.tintColor = UIColor.systemGray
        configureAccessibility()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)

        if navigationController != nil {
            backButton.isHidden = false
            closeButton.isHidden = true
        } else {
            backButton.isHidden = true
            closeButton.isHidden = false
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)

        guard var urlString = notification?.accessURL?.absoluteString else {
            exitScreen()
            return
        }

        if !urlString.hasPrefix("http") {
            urlString = "https://" + urlString
        }

        guard let url = URL(string: urlString) else {
            exitScreen()
            return
        }

        let request = URLRequest(url: url)
        webView.load(request)
        webView.navigationDelegate = self
        webView.uiDelegate = self

        markNotificationAsRead()
    }

    override func dismiss(animated flag: Bool, completion: (() -> Void)? = nil) {
        super.dismiss(animated: flag, completion: completion)

        dismissalDelegate?.viewControllerDidDismiss()
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        startLoading()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        stopLoading()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        stopLoading()
        DebugLogger.shared.log(.error, "Failed to load page: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            UIApplication.shared.open(url)
        }
        
        return nil
    }

    private func configureAccessibility() {
        backButton.accessibilityLabel = "Back"
        backButton.accessibilityTraits = .button
        closeButton.accessibilityLabel = "Close"
        closeButton.accessibilityTraits = .button
        activityIndicator.accessibilityLabel = "Loading content"
        webView.accessibilityIdentifier = "MessageContentWebView"
    }

    @IBAction func back(_ sender: Any) {
        exitScreen()
    }

    @IBAction func dismissVC(_ sender: Any) {
        exitScreen()
    }

    private func exitScreen() {
        if let navigationController {
            navigationController.popViewController(animated: true)
        } else {
            dismiss(animated: true)
        }
    }

    private func markNotificationAsRead() {
        guard let notification else { return }

        manager?.markNotificationAsRead(notificationID: notification.id, completion: { _ in
            DebugLogger.shared.log(.info, "Notification marked as read")
        })
    }

    private func startLoading() {
        activityIndicator.startAnimating()
        activityIndicator.isHidden = false
    }

    private func stopLoading() {
        activityIndicator.stopAnimating()
        activityIndicator.isHidden = true
    }
}
