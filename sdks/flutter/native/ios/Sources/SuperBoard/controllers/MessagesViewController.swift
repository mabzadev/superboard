import UIKit

class MessagesViewController: UIViewController, UITableViewDataSource, UITableViewDelegate, UIScrollViewDelegate {

    static func loadVCFromNib() -> MessagesViewController? {
        var vc: MessagesViewController?

#if SWIFT_PACKAGE
        vc = MessagesViewController.init(nibName: "MessagesViewController", bundle: Bundle.module)
#else
        vc = MessagesViewController.init(nibName: "MessagesViewController", bundle: Bundle.framework)
#endif

        return vc
    }

    @IBOutlet weak var activityIndicator: UIActivityIndicatorView!
    @IBOutlet weak var tableView: UITableView!
    @IBOutlet weak var titleLabel: UILabel!

    private struct Constants {
        static let cellIdentifier = "MessageTableViewCell"
    }

    weak var manager: SuperBoardManager?
    var dismissalDelegate: DismissalDelegate?

    private var notifications = [SuperBoardNotification]() {
        didSet {
            tableView.reloadData()
        }
    }

    private var isLoading = false
    private var currentPage = 1
    private var canLoadMore = true

    private let refreshControl = UIRefreshControl()

    @IBOutlet weak var closeButton: UIButton!

    override func viewDidLoad() {
        super.viewDidLoad()

#if SWIFT_PACKAGE
        tableView.register(UINib(nibName: "MessageTableViewCell", bundle: Bundle.module), forCellReuseIdentifier: Constants.cellIdentifier)
#else
        tableView.register(UINib(nibName: "MessageTableViewCell", bundle: Bundle.framework), forCellReuseIdentifier: Constants.cellIdentifier)
#endif

        tableView.dataSource = self
        tableView.delegate = self

        setupRefreshControl()
        configureAccessibility()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)

        refreshNotifications()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
    }

    override func dismiss(animated flag: Bool, completion: (() -> Void)? = nil) {
        super.dismiss(animated: flag, completion: completion)

        dismissalDelegate?.viewControllerDidDismiss()
    }

    private func configureAccessibility() {
        closeButton?.accessibilityLabel = "Close"
        closeButton?.accessibilityTraits = .button
        activityIndicator.accessibilityLabel = "Loading messages"
        tableView.accessibilityIdentifier = "MessagesTableView"
    }

    private func setupRefreshControl() {
        refreshControl.addTarget(self, action: #selector(refreshNotifications), for: .valueChanged)
        refreshControl.tintColor = .white
        tableView.refreshControl = refreshControl
    }

    @IBAction func close(_ sender: Any) {
        self.dismiss(animated: true)
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        return notifications.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        guard let cell = tableView.dequeueReusableCell(withIdentifier: Constants.cellIdentifier, for: indexPath) as? MessageTableViewCell else {
            return UITableViewCell()
        }

        let notif = notifications[indexPath.row]

        cell.messageTitleLabel.text = notif.title
        cell.messageSubtitleLabel.text = notif.subtitle
        cell.newMessageIndicatorView.isHidden = notif.read

        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        let notif = notifications[indexPath.row]
        goToMessage(notification: notif)
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        let offsetY = scrollView.contentOffset.y
        let contentHeight = scrollView.contentSize.height
        let frameHeight = scrollView.frame.size.height

        if offsetY > contentHeight - frameHeight - 100 {
            if !isLoading && canLoadMore {
                loadMoreNotifications()
            }
        }
    }

    private func loadMoreNotifications() {
        guard !isLoading else { return }
        isLoading = true
        currentPage += 1

        fetchNotifications(page: currentPage)
    }

    @objc private func refreshNotifications() {
        currentPage = 1
        canLoadMore = true
        fetchNotifications(page: currentPage, isRefreshing: true)
    }

    private func goToMessage(notification: SuperBoardNotification) {
        if let vc = MessageDetailsViewController.loadVCFromNib() {
            vc.notification = notification
            vc.manager = manager
            vc.dismissalDelegate = dismissalDelegate
            navigationController?.pushViewController(vc, animated: true)
        }
    }

    private func fetchNotifications(page: Int, isRefreshing: Bool = false) {
        if !isRefreshing {
            activityIndicator.startAnimating()
        }

        manager?.getNotifications(page: page, completion: { notifications in
            self.activityIndicator.stopAnimating()
            self.isLoading = false
            self.refreshControl.endRefreshing()

            guard let newNotifications = notifications else {
                AlertHelper.showGenericError()
                return
            }

            if isRefreshing {
                self.notifications = newNotifications
            } else {
                if newNotifications.isEmpty {
                    self.canLoadMore = false
                }
                self.notifications.append(contentsOf: newNotifications)
            }
        })
    }
}
