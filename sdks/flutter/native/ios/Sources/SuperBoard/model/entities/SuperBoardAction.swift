
import Foundation

class SuperBoardAction {

    let mainBlock: SuperBoardEmptyClosure

    let failureBlock: SuperBoardEmptyClosure

    init(mainBlock: @escaping SuperBoardEmptyClosure, failureBlock: @escaping SuperBoardEmptyClosure) {
        self.mainBlock = mainBlock
        self.failureBlock = failureBlock
    }
}
