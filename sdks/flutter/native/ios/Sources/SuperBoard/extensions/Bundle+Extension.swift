//
//  Bundle+Extension.swift
//
//  superboard
//

import Foundation

extension Bundle {

    static var framework: Bundle {
        get {
            let bundle = Bundle(for: SuperBoard.self)

            return bundle
        }
    }
}
