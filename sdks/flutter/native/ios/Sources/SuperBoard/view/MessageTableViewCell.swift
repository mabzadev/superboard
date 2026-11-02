import UIKit

class MessageTableViewCell: UITableViewCell {

    @IBOutlet weak var newMessageIndicatorView: UIView!

    @IBOutlet weak var messageSubtitleLabel: UILabel!

    @IBOutlet weak var messageTitleLabel: UILabel!

    override var accessibilityLabel: String? {
        get {
            var components = [String]()
            if let title = messageTitleLabel?.text, !title.isEmpty {
                components.append(title)
            }
            if let subtitle = messageSubtitleLabel?.text, !subtitle.isEmpty {
                components.append(subtitle)
            }
            if newMessageIndicatorView?.isHidden == false {
                components.append("Unread")
            }
            return components.joined(separator: ", ")
        }
        set { super.accessibilityLabel = newValue }
    }

    override var accessibilityTraits: UIAccessibilityTraits {
        get { return .button }
        set { super.accessibilityTraits = newValue }
    }
}
