//
//  Action.swift
//
//  opengrow
//


import Foundation

/// A class that represents an executable action with success and failure handling.
class OpenGrowAction {

    /// The block to execute when the action is triggered.
    let mainBlock: OpenGrowEmptyClosure

    /// The block to execute if the action needs to be marked as failed.
    let failureBlock: OpenGrowEmptyClosure

    /// Initializes an Action with an execution block and a failure block.
    /// - Parameters:
    ///   - execution: A closure representing the main action to perform.
    ///   - failure: A closure that handles errors if the execution fails.
    init(mainBlock: @escaping OpenGrowEmptyClosure, failureBlock: @escaping OpenGrowEmptyClosure) {
        self.mainBlock = mainBlock
        self.failureBlock = failureBlock
    }
}
